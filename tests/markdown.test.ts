import { describe, expect, test } from 'bun:test';
import { diffMarkdown, isMarkdownPath, splitBlocks, splitFrontMatter } from '../src/markdown/markdownDiff.ts';

const OLD = `# Agents

Intro paragraph.

## Localization

All user-facing strings go through \`t()\`.

- Add keys to \`en.json\` first
- Run \`bun run i18n:check\`

Follow the [style guide](docs/style.md) for tone.

## Testing

Run \`bun test\` before pushing.

<!-- owner: @alice -->
`;

const NEW = `# Agents

Intro paragraph.

## Localization

All user-facing strings go through \`t()\` and must have an Estonian translation.

- Add keys to \`en.json\` and \`et.json\`
- Run \`bun run i18n:check\`

Follow the [style guide](docs/STYLE.md) for tone.

## Commits

Use conventional commits.

<!-- owner: @roger -->
`;

describe('diffMarkdown', () => {
  const result = diffMarkdown(OLD, NEW, { resolve: (target, kind) => `https://x/${kind}/${target}` });
  const types = result.rows.map(row => row.type);
  test('unchanged blocks are "same"', () => {
    expect(types.slice(0, 3)).toEqual(['unchanged', 'unchanged', 'unchanged']);
  });
  test('changed paragraph gets word-level ins', () => {
    const paragraph = result.rows.find(row => row.type === 'modified' && row.html.includes('<ins>'))!;
    expect(paragraph.html).toContain('<ins> and must have an Estonian translation</ins>');
  });
  test('changed list item shows del + ins', () => {
    const listItem = result.rows.find(row => row.html.includes('<li>') && row.type === 'modified')!;
    expect(listItem.html).toMatch(/<del>first<\/del>/);
    expect(listItem.html).toMatch(/<ins>and <code>et.json<\/code><\/ins>/);
  });
  test('link target change that renders identically is flagged hidden', () => {
    const link = result.rows.find(row => row.hiddenChange?.startsWith('link target'))!;
    expect(link.hiddenChange).toBe('link target changed: docs/style.md → docs/STYLE.md');
    expect(link.html).toContain('href="https://x/link/docs/STYLE.md"');
    expect(link.html).toContain('target="_blank"');
  });
  test('HTML comment change is flagged hidden', () => {
    expect(result.rows.some(row => row.hiddenChange?.startsWith('HTML comment changed'))).toBe(true);
  });
  test('an unrelated replaced section shows as removed + added, not a noisy word diff', () => {
    expect(result.rows.some(row => row.type === 'removed' && row.html.includes('Testing'))).toBe(true);
    expect(result.rows.some(row => row.type === 'added' && row.html.includes('Commits'))).toBe(true);
    expect(result.rows.some(row => row.type === 'added' && row.html.includes('conventional'))).toBe(true);
    expect(result.rows.some(row => row.html.includes('<del>Testing'))).toBe(false);
  });
  test('every changed source block is represented (nothing silently dropped)', () => {
    expect(result.rows.filter(row => row.type !== 'unchanged').length).toBeGreaterThanOrEqual(6);
  });
});

describe('edge cases', () => {
  test('new file: everything added; deleted file: everything removed', () => {
    expect(diffMarkdown(null, '# A\n\ntext').rows.map(row => row.type)).toEqual(['added', 'added']);
    expect(diffMarkdown('# A\n\ntext', null).rows.map(row => row.type)).toEqual(['removed', 'removed']);
  });
  test('reference definition change is a doc-level hidden change', () => {
    const result = diffMarkdown(
      'See [docs][d].\n\n[d]: https://a.example\n',
      'See [docs][d].\n\n[d]: https://b.example\n',
    );
    expect(result.documentHiddenChanges).toEqual(['link reference [d]: https://a.example → https://b.example']);
    expect(result.rows.every(row => row.type === 'unchanged')).toBe(true);
  });
  test('reference links resolve inside single-block renders', () => {
    const result = diffMarkdown(null, 'See [docs][d].\n\n[d]: https://b.example\n');
    expect(result.rows[0]!.html).toContain('href="https://b.example"');
  });
  test('whitespace-only reflow is reported', () => {
    const result = diffMarkdown('a\n\n\nb\n', 'a\n\nb\n');
    expect(result.documentHiddenChanges).toEqual(['whitespace / blank-line change']);
  });
  test('front matter diff by key', () => {
    const result = diffMarkdown('---\nname: a\nold: 1\n---\n# T', '---\nname: b\nnew: 2\n---\n# T');
    expect(result.frontMatter).toEqual([
      { key: 'name', type: 'modified', oldValue: 'a', value: 'b' },
      { key: 'new', type: 'added', value: '2' },
      { key: 'old', type: 'removed', oldValue: '1' },
    ]);
  });
  test('word diff falls back when the change is inside a link URL', () => {
    const result = diffMarkdown('[a](x.md) text', '[a](y.md) text more');
    const row = result.rows[0]!;
    expect(row.type).toBe('modified');
    expect(row.html).not.toMatch(/[\uE000-\uE003]/);
  });
  test('ordered list items keep their numbers', () => {
    const { blocks } = splitBlocks('1. a\n2. b\n3. c\n');
    expect(blocks.map(block => block.kind)).toEqual(['item', 'item', 'item']);
    expect(diffMarkdown('1. a\n2. b\n3. c\n', '1. a\n2. b\n3. changed\n').rows[2]!.html).toContain('start="3"');
  });
  test('changed code block shows both the old and the new version', () => {
    const result = diffMarkdown('```sh\nbun run old\n```\n', '```sh\nbun run new\n```\n');
    expect(result.rows.map(row => row.type)).toEqual(['removed', 'added']);
    expect(result.rows[0]!.html).toContain('old');
    expect(result.rows[1]!.html).toContain('new');
  });
  test('changed table cell shows both versions', () => {
    const result = diffMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n', '| a | b |\n|---|---|\n| 1 | 3 |\n');
    expect(result.rows.map(row => row.type)).toEqual(['removed', 'added']);
  });
  test('front matter source-only change is flagged', () => {
    const result = diffMarkdown('---\na: 1\nb: 2\n---\nx', '---\nb: 2\na: 1 # note\n---\nx');
    expect(result.documentHiddenChanges[0]).toContain('front matter source changed');
  });
  test('front matter split and markdown paths', () => {
    expect(splitFrontMatter('---\na: 1\n---\nbody').body).toBe('body');
    expect(['README.md', 'x.mdx', 'a.markdown', 'a.txt'].map(isMarkdownPath)).toEqual([true, true, true, false]);
  });
});
