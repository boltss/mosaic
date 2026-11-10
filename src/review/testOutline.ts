// Test files read best as a list of test names. This turns a diff into that list: every diff
// line belongs to exactly one row, so a row's +/- counts always add up to the file's changes.
import type { DiffLine } from '../shared/types.ts';

const CODE_EXTENSIONS = '[cm]?[jt]sx?|py|go|rb|exs?|swift|kt|java|cs|dart|php|rs';
const TEST_PATH = new RegExp(
  [
    `\\.(test|spec|e2e|cy)\\.(${CODE_EXTENSIONS})$`,
    `(^|/)__tests__/.*\\.(${CODE_EXTENSIONS})$`,
    `_(test|spec)\\.(${CODE_EXTENSIONS})$`,
    `(^|/)test_[^/]+\\.py$`,
    `Tests?\\.(swift|kt|java|cs)$`,
  ].join('|'),
);

export const isTestPath = (path: string) => TEST_PATH.test(path) && !path.endsWith('.snap');

export type RowKind = 'setup' | 'group' | 'test' | 'hook' | 'rest';

export interface OutlineRow {
  kind: RowKind;
  name: string;
  /** Name of the removed test this one replaced in the same edit (usually a rename). */
  previousName?: string;
  depth: number;
  /** added/removed: the test itself was added/removed. changed: it exists on both sides and lines inside it changed. */
  state: 'added' | 'removed' | 'changed' | 'unchanged';
  /** Slice of the diff's lines this row stands for (end exclusive). */
  start: number;
  end: number;
  additions: number;
  deletions: number;
}

interface RowStart {
  kind: 'group' | 'test' | 'hook';
  name: string;
  indent: number;
  /** The name is on a later line. */
  nameComesLater?: boolean;
}

interface Rule {
  pattern: RegExp;
  kind: (match: RegExpMatchArray) => RowStart['kind'];
  name: (match: RegExpMatchArray) => string;
}

const QUOTED_STRING = `(['"\`])((?:\\\\.|(?!\\3).)*)\\3`;
const NAME_ON_LATER_LINE = /^(\s*)[xf]?(describe|context|suite|it|test|specify)(?:\.[\w.]+)?\s*[(`]/;
// `])('name', …` or `] as const)('name', …` closing an each-table, or a name alone on its own line.
const LATE_NAME = new RegExp(
  `^(\\s*)(?:\\][^('"\\x60]*\\)\\s*\\(\\s*)?()${QUOTED_STRING}\\s*,?\\s*(?:$|[(a-z_$]|async|function)`,
);
const RULES: Rule[] = [
  // JS/TS: describe('…'), it.each([...])('…'), test.skip('…'), Deno.test('…')
  {
    pattern: new RegExp(
      `^(\\s*)(?:Deno\\.)?[xf]?(describe|context|suite|it|test|specify)(?:\\.[\\w.]+)?(?:\\([^)]*\\))?\\s*\\(\\s*${QUOTED_STRING}`,
    ),
    kind: match => (/describe|context|suite/.test(match[2]!) ? 'group' : 'test'),
    name: match => match[4]!,
  },
  // Ruby / Elixir: describe "…" do, it '…' do
  {
    pattern: new RegExp(`^(\\s*)(?:RSpec\\.)?(describe|context|feature|it|specify|scenario|test)\\s+${QUOTED_STRING}`),
    kind: match => (/describe|context|feature/.test(match[2]!) ? 'group' : 'test'),
    name: match => match[4]!,
  },
  {
    pattern: /^(\s*)(?:RSpec\.)?(describe|context)\s+([A-Z][\w:.#]*)/,
    kind: () => 'group',
    name: match => match[3]!,
  },
  // Name not on the same line (it.each table, template literal)
  {
    pattern: NAME_ON_LATER_LINE,
    kind: match => (/describe|context|suite/.test(match[2]!) ? 'group' : 'test'),
    name: match => match[0]!.trim(),
  },
  {
    pattern: /^(\s*)(beforeEach|afterEach|beforeAll|afterAll|before|after)\s*\(/,
    kind: () => 'hook',
    name: match => match[2]!,
  },
  // Python
  { pattern: /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/, kind: () => 'test', name: match => match[2]! },
  {
    pattern:
      /^(\s*)(?:async\s+)?def\s+(setUp|tearDown|setUpClass|tearDownClass|setup_method|teardown_method|setup_class|teardown_class)\s*\(/,
    kind: () => 'hook',
    name: match => match[2]!,
  },
  { pattern: /^(\s*)class\s+(Test\w*|\w+Tests?)\b/, kind: () => 'group', name: match => match[2]! },
  // Go
  {
    pattern: /^()func\s+((?:Test|Benchmark|Fuzz|Example)\w*)\s*\(/,
    kind: () => 'test',
    name: match => match[2]!,
  },
  { pattern: /^(\s*)\w+\.Run\(\s*"((?:\\.|[^"])*)"/, kind: () => 'test', name: match => match[2]! },
  // Swift / Kotlin / Java / C#
  {
    pattern:
      /^(\s*)(?:(?:public|private|internal|override|open|final|static|async|suspend)\s+)*(?:func|fun|void)\s+(`[^`]+`|test\w*)\s*\(/,
    kind: () => 'test',
    name: match => match[2]!.replace(/`/g, ''),
  },
];

export function parseStart(text: string): RowStart | null {
  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (match)
      return {
        kind: rule.kind(match),
        name: rule.name(match),
        indent: match[1]!.replace(/\t/g, '  ').length,
        nameComesLater: rule.pattern === NAME_ON_LATER_LINE || undefined,
      };
  }
  return null;
}

const indentOf = (text: string) => text.match(/^\s*/)![0].replace(/\t/g, '  ').length;

interface DraftRow extends OutlineRow {
  indent: number;
  hunkContext: string;
  nameComesLater?: boolean;
}

/**
 * Rows for a test file's diff, or null when no tests are recognised (show plain code then).
 * `newContent` (the file at the pull request head) lets changes deep inside an unchanged test be
 * named after that test; without it they stay a 'rest' row.
 */
export function testOutline(lines: DiffLine[], newContent?: string | null): OutlineRow[] | null {
  const rows: DraftRow[] = [];
  let current: DraftRow | null = null;
  let hunkContext = '';
  const openRow = (kind: RowKind, name: string, indent: number, index: number): DraftRow => {
    const row: DraftRow = {
      kind,
      name,
      indent,
      hunkContext,
      depth: 0,
      state: 'unchanged',
      start: index,
      end: index,
      additions: 0,
      deletions: 0,
    };
    rows.push(row);
    return row;
  };
  lines.forEach((line, index) => {
    if (line.kind === 'hunk') {
      current = null;
      hunkContext = line.text.replace(/^@@ [^@]+ @@\s*/, '');
      return;
    }
    const rowStart = parseStart(line.text);
    if (rowStart) {
      current = openRow(rowStart.kind, rowStart.name, rowStart.indent, index);
      current.nameComesLater = rowStart.nameComesLater;
      if (line.kind === 'addition') current.state = 'added';
      else if (line.kind === 'deletion') current.state = 'removed';
    } else if (!current) {
      current = openRow(line.newNumber === 1 || line.oldNumber === 1 ? 'setup' : 'rest', '', 0, index);
    }
    current.end = index + 1;
    if (line.kind === 'addition') current.additions++;
    else if (line.kind === 'deletion') current.deletions++;
  });
  if (!rows.some(row => row.kind === 'test' || row.kind === 'group')) return null;

  const fileLines = newContent?.split('\n');
  for (const row of rows) {
    if (row.state === 'unchanged' && row.additions + row.deletions > 0) row.state = 'changed';
    if (row.kind === 'setup') row.name = 'Imports and setup';
    if (row.nameComesLater) {
      const lateName = lines
        .slice(row.start + 1, row.end)
        .map(line => line.text.match(LATE_NAME))
        .find(Boolean);
      if (lateName) row.name = lateName[4]!;
    }
    if (row.kind !== 'rest') continue;
    const enclosing = (fileLines && enclosingTest(lines, row, fileLines)) || parseStart(row.hunkContext);
    // Lines directly inside a describe aren't a test: they stay an open, unnamed row.
    if (enclosing && enclosing.kind !== 'group' && fileLines) {
      row.kind = enclosing.kind;
      row.name = enclosing.name;
      row.indent = enclosing.indent;
    } else row.name = enclosing ? `Changes inside “${enclosing.name}”` : 'Changes outside any listed test';
  }
  // A removed test directly followed by an added one is one edit (usually a rename): show it once.
  for (let index = rows.length - 2; index >= 0; index--) {
    const removed = rows[index]!;
    const added = rows[index + 1]!;
    if (
      removed.state !== 'removed' ||
      added.state !== 'added' ||
      removed.kind !== added.kind ||
      removed.kind === 'rest' ||
      removed.kind === 'setup' ||
      removed.additions ||
      added.start !== removed.end ||
      removed.indent !== added.indent
    )
      continue;
    rows.splice(index, 2, {
      ...added,
      previousName: removed.name === added.name ? undefined : removed.name,
      state: 'changed',
      start: removed.start,
      deletions: removed.deletions + added.deletions,
    });
  }
  const indents = [
    ...new Set(rows.filter(row => row.kind !== 'setup' && row.kind !== 'rest').map(row => row.indent)),
  ].toSorted((first, second) => first - second);
  return rows
    .filter(row => row.kind === 'test' || row.kind === 'group' || row.additions + row.deletions > 0)
    .map(({ indent, hunkContext: _hunkContext, nameComesLater: _nameComesLater, ...row }) => ({
      ...row,
      depth: row.kind === 'setup' || row.kind === 'rest' ? 0 : indents.indexOf(indent),
    }));
}

/** The test/hook/group in the new file that contains this row's first changed line. */
function enclosingTest(lines: DiffLine[], row: { start: number; end: number }, fileLines: string[]): RowStart | null {
  const slice = lines.slice(row.start, row.end);
  const firstChanged =
    slice.find(line => line.kind !== 'context' && line.text.trim()) ?? slice.find(line => line.kind !== 'context');
  if (!firstChanged) return null;
  // A removed line has no place in the new file: anchor on the nearest line that does.
  const position = slice.indexOf(firstChanged);
  const anchor =
    firstChanged.newNumber ??
    slice.slice(position).find(line => line.newNumber)?.newNumber ??
    slice
      .slice(0, position)
      .toReversed()
      .find(line => line.newNumber)?.newNumber;
  if (!anchor) return null;
  const indentLimit = indentOf(firstChanged.text);
  for (let lineIndex = Math.min(anchor, fileLines.length) - 1; lineIndex >= 0; lineIndex--) {
    const rowStart = parseStart(fileLines[lineIndex]!);
    if (rowStart && rowStart.indent < indentLimit) return rowStart;
  }
  return null;
}
