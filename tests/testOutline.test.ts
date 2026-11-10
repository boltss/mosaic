import { describe, expect, test } from 'bun:test';
import { isTestPath, parseStart, testOutline } from '../src/review/testOutline.ts';
import type { DiffLine } from '../src/shared/types.ts';

/** "+text" / "-text" / " text" / "@@ … @@ ctx"; numbers count up from `from`. */
const diffLines = (spec: string, from = 1): DiffLine[] => {
  let oldNumber = from,
    newNumber = from;
  return spec.split('\n').map(row => {
    if (row[0] === '@') return { kind: 'hunk', text: row };
    const text = row.slice(1);
    if (row[0] === '+') return { kind: 'addition', text, newNumber: newNumber++ };
    if (row[0] === '-') return { kind: 'deletion', text, oldNumber: oldNumber++ };
    return { kind: 'context', text, oldNumber: oldNumber++, newNumber: newNumber++ };
  });
};
const brief = (lines: DiffLine[], content?: string) =>
  testOutline(lines, content)?.map(
    row => `${'  '.repeat(row.depth)}${row.kind}:${row.name} [${row.state} +${row.additions} -${row.deletions}]`,
  );

describe('isTestPath', () => {
  test.each([
    ['app/__tests__/lib/capture-gates.test.ts', true],
    ['src/a.spec.tsx', true],
    ['app/__tests__/helpers.ts', true],
    ['pkg/x_test.go', true],
    ['tests/test_api.py', true],
    ['spec/user_spec.rb', true],
    ['AppTests/LoginTests.swift', true],
    ['src/a.ts', false],
    ['src/__snapshots__/a.test.tsx.snap', false],
    ['src/latest.ts', false],
    ['docs/testing.md', false],
  ])('%s → %p', (path, want) => expect(isTestPath(path)).toBe(want));
});

describe('parseStart', () => {
  test.each([
    [`describe('Feed', () => {`, 'group', 'Feed'],
    [`  it("asks for 'camera' access", () => {`, 'test', `asks for 'camera' access`],
    ['  test.skip(`x ${y}`, async () => {', 'test', 'x ${y}'],
    [`  it.each([1, 2])('adds %i', n => {`, 'test', 'adds %i'],
    ['  beforeEach(() => {', 'hook', 'beforeEach'],
    ['    def test_login(self):', 'test', 'test_login'],
    ['class TestApi(Base):', 'group', 'TestApi'],
    ['func TestParse(t *testing.T) {', 'test', 'TestParse'],
    ['\tt.Run("empty input", func(t *testing.T) {', 'test', 'empty input'],
    [`  it 'saves' do`, 'test', 'saves'],
    ['RSpec.describe User do', 'group', 'User'],
    ['  func testLogin() async throws {', 'test', 'testLogin'],
  ])('%s', (line, kind, name) => expect(parseStart(line)).toMatchObject({ kind, name }));
  test.each([
    `const items = it;`,
    `  expect(test(x)).toBe(1);`,
    `import { describe, it } from 'bun:test';`,
    `  iterate(() => {`,
    `// it('commented')`,
  ])('not a test: %s', line => expect(parseStart(line)).toBeNull());
});

describe('testOutline', () => {
  test('new file: setup, groups, hooks and tests; every line is counted once', () => {
    const lines = diffLines(`@@ -0,0 +1,12 @@
+import { x } from './x';
+
+describe('Feed', () => {
+  beforeEach(() => {
+    reset();
+  });
+  it('measures a face', () => {
+    expect(x()).toBe(1);
+  });
+  it('takes photos', () => {});
+});`);
    expect(brief(lines)).toEqual([
      'setup:Imports and setup [changed +2 -0]',
      'group:Feed [added +1 -0]',
      '  hook:beforeEach [added +3 -0]',
      '  test:measures a face [added +3 -0]',
      '  test:takes photos [added +2 -0]',
    ]);
    const rows = testOutline(lines)!;
    expect(rows.reduce((sum, row) => sum + row.additions, 0)).toBe(11);
    expect(rows.map(row => [row.start, row.end])).toEqual([
      [1, 3],
      [3, 4],
      [4, 7],
      [7, 10],
      [10, 12],
    ]);
  });

  test('modified file: added, removed and untouched tests; unchanged setup is dropped', () => {
    expect(
      brief(
        diffLines(`@@ -1,9 +1,9 @@
 import a from 'a';
 describe('S', () => {
   it('stays', () => {});
-  it('goes', () => {
-    old();
-  });
+  it('arrives', () => {
+    fresh();
+  });
 });`),
      ),
    ).toEqual(['group:S [unchanged +0 -0]', '  test:stays [unchanged +0 -0]', '  test:arrives [changed +3 -3]']);
  });

  test('a removed test followed by an added one is shown once, with the old name', () => {
    const rows = testOutline(
      diffLines(`@@ -1,6 +1,6 @@
 describe('S', () => {
-  it('should save', () => {
+  it('saves', () => {
     a();
-    b();
+    B();
   });
   it('other', () => {});`),
    )!;
    expect(rows.map(row => [row.name, row.previousName, row.state, row.additions, row.deletions])).toEqual([
      ['S', undefined, 'unchanged', 0, 0],
      ['saves', 'should save', 'changed', 2, 2],
      ['other', undefined, 'unchanged', 0, 0],
    ]);
    expect(rows[1]).toMatchObject({ start: 2, end: 8 });
  });

  test('names on a later line: each-tables and wrapped calls', () => {
    expect(
      brief(
        diffLines(`@@ -0,0 +1,9 @@
+describe('S', () => {
+  it.each([
+    [1, 2],
+  ] as const)('adds %i', (a, b) => {});
+  it(
+    'has a very long name',
+    async () => {},
+  );
+});`),
      ),
    ).toEqual(['group:S [added +1 -0]', '  test:adds %i [added +3 -0]', '  test:has a very long name [added +5 -0]']);
  });

  test('change deep inside a test: named from the file, else from the hunk header', () => {
    const file = `describe('S', () => {\n  it('first', () => {\n    a();\n    b();\n    c();\n    d();\n  });\n});`;
    const lines = diffLines(`@@ -4,3 +4,3 @@ describe('S', () => {\n     b();\n-    c();\n+    C();\n     d();`, 4);
    expect(brief(lines)).toBeUndefined(); // no test line in the diff itself
    const withSibling = lines.concat(
      diffLines(`@@ -20,2 +20,3 @@ describe('S', () => {\n   });\n+  it('new', () => {});`, 20),
    );
    expect(brief(withSibling)).toEqual(['rest:Changes inside “S” [changed +1 -1]', 'test:new [added +1 -0]']);
    expect(
      brief(withSibling, `describe('S', () => {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const C = 4;\n});`),
    ).toEqual(['rest:Changes inside “S” [changed +1 -1]', 'test:new [added +1 -0]']);
    expect(brief(withSibling, file)).toEqual(['test:first [changed +1 -1]', 'test:new [added +1 -0]']);
  });

  test('a removed line is anchored on a neighbouring line of the new file', () => {
    const file = `describe('S', () => {\n  it('first', () => {\n    a();\n  });\n  it('second', () => {});\n});`;
    const lines = diffLines(
      `@@ -3,3 +3,2 @@ describe('S', () => {\n     a();\n-    gone();\n   });\n   it('second', () => {});`,
      3,
    );
    expect(brief(lines, file)).toEqual(['test:first [changed +0 -1]', 'test:second [unchanged +0 -0]']);
  });

  test('files without recognisable tests fall back to code', () => {
    expect(testOutline(diffLines(`@@ -0,0 +1,2 @@\n+export const helper = 1;\n+export const other = 2;`))).toBeNull();
  });
});
