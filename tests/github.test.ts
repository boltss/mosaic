import { describe, expect, test } from 'bun:test';
import { parseUnifiedDiff, unquoteGitPath } from '../src/github/rawDiff.ts';
import {
  diffEntriesQuery,
  embeddedPayloads,
  GitHubShapeError,
  NotLoggedInError,
  lineKind,
  parseChangesRoute,
  parseDiffEntries,
  planBatches,
  statusFromChangeType,
} from '../src/github/parse.ts';
import { GitHubSessionSource, pullRequestFromPath } from '../src/github/source.ts';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 import x from 'x';
-const a = 1;
+const a = 2;
+const b = 3;

@@ -10,2 +11,2 @@ function f() {
-  old();
+  next();
 }
\\ No newline at end of file
diff --git a/old/name.ts b/new/name.ts
similarity index 100%
rename from old/name.ts
rename to new/name.ts
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 333..000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
diff --git a/img.png b/img.png
new file mode 100644
index 000..444
Binary files /dev/null and b/img.png differ
diff --git "a/sp ace/f\\303\\266o.md" "b/sp ace/f\\303\\266o.md"
--- "a/sp ace/f\\303\\266o.md"
+++ "b/sp ace/f\\303\\266o.md"
@@ -1 +1 @@
-a
+b
`;

describe('parseUnifiedDiff', () => {
  const diffs = parseUnifiedDiff(DIFF);
  test('finds every file, including renames, deletions, binaries and quoted paths', () => {
    expect([...diffs.keys()]).toEqual(['src/a.ts', 'new/name.ts', 'gone.txt', 'img.png', 'sp ace/föo.md']);
  });
  test('keeps blank context lines and line numbers, uses hunk counts', () => {
    const diff = diffs.get('src/a.ts')!;
    expect(diff.lines.map(line => line.kind)).toEqual([
      'hunk',
      'context',
      'deletion',
      'addition',
      'addition',
      'context',
      'hunk',
      'deletion',
      'addition',
      'context',
    ]);
    const blank = diff.lines[5]!;
    expect(blank).toMatchObject({ kind: 'context', text: '', oldNumber: 3, newNumber: 4 });
    expect(diff.lines[8]).toMatchObject({ kind: 'addition', text: '  next();', newNumber: 11 });
  });
  test('deleted file uses the old path; binary flagged', () => {
    expect(diffs.get('gone.txt')!.lines.filter(line => line.kind === 'deletion')).toHaveLength(2);
    expect(diffs.get('img.png')!.binary).toBe(true);
  });
  test('unquotes octal escapes', () => expect(unquoteGitPath('"a\\303\\266"')).toBe('aö'));
});

const routeHtml = (route: unknown, extra = '') =>
  `<html><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { pullRequestsChangesRoute: route }, title: 'Page title' })}</script>${extra}</html>`;
const HEAD = 'a'.repeat(40),
  BASE = 'b'.repeat(40);

describe('parseChangesRoute', () => {
  test('maps summaries and finds oids', () => {
    const route = parseChangesRoute(
      routeHtml({
        pullRequest: { title: 'Move theme' },
        comparison: { headOid: HEAD, baseOid: BASE },
        diffSummaries: [
          {
            path: 'a.ts',
            changeType: 'MODIFIED',
            linesAdded: 3,
            linesDeleted: 1,
            markedAsViewed: true,
            isVendored: false,
          },
          { path: 'b.ts', changeType: 'ADDED', linesAdded: 5, linesDeleted: 0, markedAsViewed: false },
        ],
      }),
    );
    expect(route.title).toBe('Move theme');
    expect(route.headCommitId).toBe(HEAD);
    expect(route.baseCommitId).toBe(BASE);
    expect(route.range).toBe(HEAD);
    expect(route.summaries).toEqual([
      { path: 'a.ts', status: 'modified', additions: 3, deletions: 1, viewed: true, isVendored: undefined },
      { path: 'b.ts', status: 'added', additions: 5, deletions: 0, viewed: false, isVendored: undefined },
    ]);
  });
  test('throws a shape error when the page has no route (logged out / old UI)', () => {
    expect(() => parseChangesRoute('<html><meta name="user-login" content=""></html>')).toThrow(NotLoggedInError);
    expect(() => parseChangesRoute('<html><meta name="user-login" content="roger"></html>')).toThrow(GitHubShapeError);
    expect(() => parseChangesRoute(routeHtml({ diffSummaries: [{ path: 'x' }] }))).toThrow(/markedAsViewed/);
  });
  test('ignores unrelated or broken embedded blobs', () => {
    expect(
      embeddedPayloads('<script type="application/json" data-target="react-partial.embeddedData">{bad</script>'),
    ).toEqual([]);
  });
  test('change types', () => {
    expect(
      ['ADDED', 'DELETED', 'REMOVED', 'RENAMED', 'COPIED', 'MODIFIED', 'CHANGED', undefined].map(statusFromChangeType),
    ).toEqual(['added', 'deleted', 'deleted', 'renamed', 'renamed', 'modified', 'modified', 'modified']);
  });
});

describe('parseDiffEntries', () => {
  const entry = (overrides: object) => ({
    path: 'f.ts',
    isBinary: false,
    isTooBig: false,
    truncatedReason: null,
    linesChanged: 2,
    diffLines: [
      { type: 'HUNK', text: '@@ -1,2 +1,2 @@', left: 0, right: 0 },
      { type: 'DELETION', text: '-old', html: '<span class="pl-k">old</span>', left: 1, right: 0 },
      { type: 'ADDITION', text: '+new', left: 0, right: 1 },
      { type: 'CONTEXT', text: ' same', left: 2, right: 2 },
    ],
    oldTreeEntry: { path: 'f.ts' },
    newTreeEntry: { path: 'f.ts', isGenerated: true },
    oldCommitOid: BASE,
    newCommitOid: HEAD,
    ...overrides,
  });
  test('maps line kinds, numbers, html; strips markers only when every line has one', () => {
    const { diffs, details } = parseDiffEntries([entry({})]);
    const diff = diffs[0]!;
    expect(diff.lines.map(line => [line.kind, line.text, line.oldNumber, line.newNumber])).toEqual([
      ['hunk', '@@ -1,2 +1,2 @@', undefined, undefined],
      ['deletion', 'old', 1, undefined],
      ['addition', 'new', undefined, 1],
      ['context', 'same', 2, 2],
    ]);
    expect(diff.lines[1]!.html).toContain('pl-k');
    expect(diff.complete).toBe(true);
    expect(diff.isGenerated).toBe(true);
    expect(details.get('f.ts')).toEqual({ oldPath: undefined, oldCommitId: BASE, newCommitId: HEAD });
  });
  test('strips the marker from highlighted html too (live GitHub shape)', () => {
    const { diffs } = parseDiffEntries([
      entry({
        diffLines: [
          { type: 'DELETION', text: '-- **a**', html: '-<span class="pl-v">-</span> **a**', left: 1, right: 0 },
          { type: 'ADDITION', text: '++x', html: '+<span class="pl-k">+</span>x', left: 0, right: 1 },
          { type: 'CONTEXT', text: '  k: 1', html: '  <span class="pl-ent">k</span>: 1', left: 2, right: 2 },
          { type: 'CONTEXT', text: ' ', html: '<br>', left: 3, right: 3 },
        ],
      }),
    ]);
    expect(diffs[0]!.lines.map(line => line.html)).toEqual([
      '<span class="pl-v">-</span> **a**',
      '<span class="pl-k">+</span>x',
      ' <span class="pl-ent">k</span>: 1',
      '<br>',
    ]);
  });
  test('unmarked text is left alone', () => {
    const { diffs } = parseDiffEntries([
      entry({
        diffLines: [
          { type: 'ADDITION', text: '+5 is a number', left: 0, right: 1 },
          { type: 'DELETION', text: 'x', left: 1, right: 0 },
        ],
      }),
    ]);
    expect(diffs[0]!.lines.map(line => line.text)).toEqual(['+5 is a number', 'x']);
  });
  test('too big / truncated / empty-but-changed are incomplete', () => {
    expect(parseDiffEntries([entry({ isTooBig: true })]).diffs[0]!.complete).toBe(false);
    expect(parseDiffEntries([entry({ truncatedReason: 'MAX_LINES' })]).diffs[0]!.complete).toBe(false);
    expect(parseDiffEntries([entry({ diffLines: [] })]).diffs[0]!.complete).toBe(false);
    expect(parseDiffEntries([entry({ diffLines: [], linesChanged: 0 })]).diffs[0]!.complete).toBe(true);
  });
  test('rename old path is captured', () => {
    expect(parseDiffEntries([entry({ oldTreeEntry: { path: 'was.ts' } })]).details.get('f.ts')!.oldPath).toBe('was.ts');
  });
  test('rejects non-arrays', () => expect(() => parseDiffEntries({})).toThrow(GitHubShapeError));
  test('line kind fallbacks', () =>
    expect(['+', '-', 'hunk', 'INJECTED_CONTEXT', 'addition'].map(lineKind)).toEqual([
      'addition',
      'deletion',
      'hunk',
      'context',
      'addition',
    ]));
});

describe('batching', () => {
  test('respects file and length limits and keeps order', () => {
    const paths = Array.from({ length: 100 }, (_unused, index) => `apps/mobile/src/components/Component${index}.tsx`);
    const batches = planBatches(paths, 6000, 40);
    expect(batches.flat()).toEqual(paths);
    expect(batches.every(batch => batch.length <= 40)).toBe(true);
    const long = Array.from({ length: 50 }, (_unused, index) => `${'very/long/path/'.repeat(12)}f${index}.ts`);
    for (const batch of planBatches(long, 6000, 40)) {
      expect(new URLSearchParams(diffEntriesQuery(batch, null)).toString().length).toBeLessThan(6200);
    }
  });
  test('query encodes paths twice like GitHub does', () => {
    const query = diffEntriesQuery(['app/(tabs)/_layout.tsx', 'a,b.ts'], 'abc');
    expect(query).toContain('paths=app%252F%28tabs%29%252F_layout.tsx%2Ca%252Cb.ts');
    expect(query).toContain('range=abc');
    expect(new URLSearchParams(query).get('paths')!.split(',').map(decodeURIComponent)).toEqual([
      'app/(tabs)/_layout.tsx',
      'a,b.ts',
    ]);
  });
});

describe('GitHubSessionSource', () => {
  const reference = { owner: 'o', repository: 'r', number: 7 };
  test('setViewed posts/deletes file_review with GitHub headers and nonce', async () => {
    const calls: [string, RequestInit][] = [];
    const source = new GitHubSessionSource(reference, {
      fetch: async (url: string, init?: RequestInit) => {
        calls.push([url, init!]);
        return new Response('{}', { status: 200 });
      },
      background: async () => ({ ok: true, status: 200, text: '' }),
      nonce: () => 'n1',
    });
    const pullRequest = { ...reference, title: '', range: null, headCommitId: null, baseCommitId: null };
    await source.setViewed(pullRequest, 'a/b.ts', true);
    await source.setViewed(pullRequest, 'a/b.ts', false);
    expect(calls[0]![0]).toBe('https://github.com/o/r/pull/7/file_review');
    expect(calls[0]![1].method).toBe('POST');
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ path: 'a/b.ts', viewed: 'viewed' });
    expect((calls[0]![1].headers as Record<string, string>)['X-Fetch-Nonce']).toBe('n1');
    expect(calls[1]![1].method).toBe('DELETE');
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ path: 'a/b.ts', _method: 'delete' });
  });
  test('setViewed surfaces HTTP failures', async () => {
    const source = new GitHubSessionSource(reference, {
      fetch: async () => new Response('', { status: 422 }),
      background: async () => ({ ok: true, status: 200, text: '' }),
      nonce: () => null,
    });
    await expect(
      source.setViewed({ ...reference, title: '', range: null, headCommitId: null, baseCommitId: null }, 'x', true),
    ).rejects.toThrow(/422/);
  });
  test('loadFileContent uses per-file oids and old path for the old side', async () => {
    const urls: string[] = [];
    const source = new GitHubSessionSource(reference, {
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              path: 'new name.md',
              diffLines: [],
              linesChanged: 0,
              oldTreeEntry: { path: 'old.md' },
              newTreeEntry: {},
              oldCommitOid: BASE,
              newCommitOid: HEAD,
            },
          ]),
          { status: 200 },
        ),
      background: async request => {
        if (request.type === 'rawFile') urls.push(request.url);
        return { ok: true, status: 200, text: 'x' };
      },
      nonce: () => null,
    });
    const pullRequest = { ...reference, title: '', range: null, headCommitId: null, baseCommitId: null };
    await source.loadDiffBatch(pullRequest, ['new name.md']);
    await source.loadFileContent(pullRequest, 'new name.md', 'old');
    await source.loadFileContent(pullRequest, 'new name.md', 'new');
    expect(urls).toEqual([
      `https://github.com/o/r/raw/${BASE}/old.md`,
      `https://github.com/o/r/raw/${HEAD}/new%20name.md`,
    ]);
  });
  test('loadImage asks the background for the image at the right commit', async () => {
    const asked: string[] = [];
    const pullRequest = { ...reference, title: '', range: null, headCommitId: HEAD, baseCommitId: BASE };
    const source = new GitHubSessionSource(reference, {
      fetch: async () => new Response('[]', { status: 200 }),
      background: async request => {
        if (request.type !== 'rawImage') return { ok: false, error: 'unexpected' };
        asked.push(request.url);
        return request.url.includes(BASE)
          ? { ok: true, status: 404, text: null }
          : { ok: true, status: 200, text: null, dataUrl: 'data:image/png;base64,AA==', bytes: 1 };
      },
      nonce: () => null,
    });
    expect(await source.loadImage(pullRequest, 'a/icon 1.png', 'new')).toEqual({
      url: 'data:image/png;base64,AA==',
      bytes: 1,
    });
    expect(await source.loadImage(pullRequest, 'a/icon 1.png', 'old')).toBeNull();
    expect(asked).toEqual([
      `https://github.com/o/r/raw/${HEAD}/a/icon%201.png`,
      `https://github.com/o/r/raw/${BASE}/a/icon%201.png`,
    ]);
  });
  test('pullRequestFromPath', () => {
    expect(pullRequestFromPath('/acme/habit-tracker/pull/410/changes')).toEqual({
      owner: 'acme',
      repository: 'habit-tracker',
      number: 410,
    });
    expect(pullRequestFromPath('/acme/habit-tracker/pulls')).toBeNull();
  });
});
