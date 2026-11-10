// Block-level markdown diff with word-level highlights and "hidden change" detection.
// Returns unsanitised HTML strings; the UI sanitises with DOMPurify before rendering.
import MarkdownIt from 'markdown-it';
import { diffArrays, diffWordsWithSpace } from 'diff';
import { parse as parseYaml } from 'yaml';
import * as zod from 'zod';

type MarkdownRenderer = InstanceType<typeof MarkdownIt>;
type References = Record<string, { href: string; title?: string }>;
// markdown-it's environment is an untyped bag; references live under `references`.
type Environment = { references?: References } & Record<string, unknown>;

export type BlockKind = 'heading' | 'paragraph' | 'item' | 'quote' | 'code' | 'table' | 'html' | 'hr' | 'other';

export interface Block {
  kind: BlockKind;
  source: string;
  start: number;
  end: number;
}

export interface LinkContext {
  /** Rewrite a relative link/image target (resolved against the file's directory) to an absolute URL. */
  resolve: (target: string, kind: 'link' | 'image') => string;
}

export type ChangeType = 'unchanged' | 'added' | 'removed' | 'modified';

export interface Row {
  type: ChangeType;
  html: string;
  /** Describes a change that the rendered block does not show (e.g. a link target). */
  hiddenChange?: string;
}

export interface FrontMatterRow {
  key: string;
  type: ChangeType;
  oldValue?: string;
  value?: string;
}

export interface MarkdownDiff {
  frontMatter: FrontMatterRow[] | null;
  rows: Row[];
  /** Changes that render to nothing anywhere in the document (e.g. reference link definitions). */
  documentHiddenChanges: string[];
}

// Private-use characters that mark where a word-level change starts and ends while markdown renders around them.
const SENTINEL = {
  deletionOpen: '',
  deletionClose: '',
  insertionOpen: '',
  insertionClose: '',
};
const SENTINEL_INSIDE_TAG = /<[^>]*[-][^>]*>/;

function createRenderer(linkContext?: LinkContext): MarkdownRenderer {
  const renderer = new MarkdownIt({ html: true, linkify: true, typographer: false });
  if (!linkContext) return renderer;
  const isRelative = (url: string) => !!url && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url);
  const defaultLink =
    renderer.renderer.rules.link_open ??
    ((tokens, index, options, _environment, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
    const token = tokens[index]!;
    const href = token.attrGet('href');
    if (href && isRelative(String(href))) token.attrSet('href', linkContext.resolve(String(href), 'link'));
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
    return defaultLink(tokens, index, options, environment, self);
  };
  const defaultImage = renderer.renderer.rules.image!;
  renderer.renderer.rules.image = (tokens, index, options, environment, self) => {
    const token = tokens[index]!;
    const imageSource = token.attrGet('src');
    if (imageSource && isRelative(String(imageSource)))
      token.attrSet('src', linkContext.resolve(String(imageSource), 'image'));
    return defaultImage(tokens, index, options, environment, self);
  };
  return renderer;
}

export function splitFrontMatter(source: string): { frontMatter: string | null; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  return match ? { frontMatter: match[1]!, body: source.slice(match[0].length) } : { frontMatter: null, body: source };
}

const BLOCK_KINDS: Record<string, BlockKind> = {
  heading_open: 'heading',
  paragraph_open: 'paragraph',
  blockquote_open: 'quote',
  fence: 'code',
  code_block: 'code',
  table_open: 'table',
  html_block: 'html',
  hr: 'hr',
  list_item_open: 'item',
};

/** Top-level blocks; list items are split out individually so lists diff per item. */
export function splitBlocks(
  body: string,
  renderer: MarkdownRenderer = createRenderer(),
): { blocks: Block[]; references: References } {
  const environment: Environment = {};
  const tokens = renderer.parse(body, environment as never);
  const lines = body.split('\n');
  const blocks: Block[] = [];
  const addBlock = (kind: BlockKind, [start, end]: [number, number]) =>
    blocks.push({ kind, start, end, source: lines.slice(start, end).join('\n').replace(/\s+$/, '') });
  let listDepth = 0;
  for (const token of tokens) {
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      if (token.level === 0) listDepth++;
      continue;
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      if (token.level === 0) listDepth--;
      continue;
    }
    if (!token.map || token.nesting === -1) continue;
    if (token.level === 0) addBlock(BLOCK_KINDS[token.type] ?? 'other', token.map);
    else if (listDepth && token.level === 1 && token.type === 'list_item_open') addBlock('item', token.map);
  }
  return { blocks, references: environment.references ?? {} };
}

const textOf = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const HIDDEN_PARTS: { pattern: RegExp; label: string }[] = [
  { pattern: /!\[[^\]]*\]\(([^)]+)\)/g, label: 'image source' },
  { pattern: /(?<!!)\[[^\]]*\]\(([^)]+)\)/g, label: 'link target' },
  { pattern: /<!--([\s\S]*?)-->/g, label: 'HTML comment' },
  { pattern: /<a\b[^>]*href="([^"]*)"/gi, label: 'link target' },
  { pattern: /<img\b[^>]*src="([^"]*)"/gi, label: 'image source' },
];

function describeHiddenChange(oldSource: string, newSource: string): string {
  const capture = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map(match => match[1]!.trim());
  const shorten = (text?: string) => (text && text.length > 60 ? text.slice(0, 57) + '…' : (text ?? '∅'));
  for (const { pattern, label } of HIDDEN_PARTS) {
    const oldParts = capture(oldSource, pattern);
    const newParts = capture(newSource, pattern);
    if (oldParts.join('\u0000') !== newParts.join('\u0000')) {
      const removed = oldParts.find(part => !newParts.includes(part));
      const added = newParts.find(part => !oldParts.includes(part));
      return `${label} changed: ${shorten(removed)} → ${shorten(added)}`;
    }
  }
  return oldSource.replace(/\s+/g, '') === newSource.replace(/\s+/g, '')
    ? 'whitespace / line-wrap change'
    : 'source-only change (renders the same)';
}

/** 0..1 share of characters two sources have in common (word-level). */
export function similarity(first: string, second: string): number {
  if (!first && !second) return 1;
  let common = 0;
  for (const part of diffWordsWithSpace(first, second))
    if (!part.added && !part.removed) common += part.value.replace(/\s+/g, '').length;
  const total = first.replace(/\s+/g, '').length + second.replace(/\s+/g, '').length;
  return total ? (2 * common) / total : 1;
}
const PAIRING_THRESHOLD = 0.4;

const WORD_DIFF_KINDS = new Set<BlockKind>(['heading', 'paragraph', 'item', 'quote']);

function wordDiffHtml(
  renderer: MarkdownRenderer,
  oldSource: string,
  newSource: string,
  environment: Environment,
): string | null {
  let combined = '';
  for (const part of diffWordsWithSpace(oldSource, newSource)) {
    if (part.removed) combined += SENTINEL.deletionOpen + part.value + SENTINEL.deletionClose;
    else if (part.added) combined += SENTINEL.insertionOpen + part.value + SENTINEL.insertionClose;
    else combined += part.value;
  }
  const html = renderer.render(combined, environment as never);
  // Sentinels must only land in text; inside tags/attributes the result would be broken.
  if (SENTINEL_INSIDE_TAG.test(html)) return null;
  const count = (sentinel: string) => html.split(sentinel).length - 1;
  if (
    count(SENTINEL.deletionOpen) !== count(SENTINEL.deletionClose) ||
    count(SENTINEL.insertionOpen) !== count(SENTINEL.insertionClose)
  )
    return null;
  return html
    .replaceAll(SENTINEL.deletionOpen, '<del>')
    .replaceAll(SENTINEL.deletionClose, '</del>')
    .replaceAll(SENTINEL.insertionOpen, '<ins>')
    .replaceAll(SENTINEL.insertionClose, '</ins>');
}

const frontMatterSchema = zod.record(zod.string(), zod.unknown());

function frontMatterRows(oldFrontMatter: string | null, newFrontMatter: string | null): FrontMatterRow[] | null {
  if (oldFrontMatter == null && newFrontMatter == null) return null;
  const load = (source: string | null): Record<string, unknown> => {
    if (source == null) return {};
    try {
      const parsed = frontMatterSchema.safeParse(parseYaml(source));
      return parsed.success ? parsed.data : { '(front matter)': source };
    } catch {
      return { '(unparsed front matter)': source };
    }
  };
  const oldValues = load(oldFrontMatter);
  const newValues = load(newFrontMatter);
  const show = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
  const keys = [...new Set([...Object.keys(newValues), ...Object.keys(oldValues)])];
  return keys.map((key): FrontMatterRow => {
    if (!(key in oldValues)) return { key, type: 'added', value: show(newValues[key]) };
    if (!(key in newValues)) return { key, type: 'removed', oldValue: show(oldValues[key]) };
    const oldValue = show(oldValues[key]);
    const value = show(newValues[key]);
    return oldValue === value ? { key, type: 'unchanged', value } : { key, type: 'modified', oldValue, value };
  });
}

/** Diff two versions of a markdown document. `oldSource` null = new file, `newSource` null = deleted file. */
export function diffMarkdown(
  oldSource: string | null,
  newSource: string | null,
  linkContext?: LinkContext,
): MarkdownDiff {
  const renderer = createRenderer(linkContext);
  const oldDocument = splitFrontMatter(oldSource ?? '');
  const newDocument = splitFrontMatter(newSource ?? '');
  const oldParsed = splitBlocks(oldDocument.body, renderer);
  const newParsed = splitBlocks(newDocument.body, renderer);
  const oldEnvironment: Environment = { references: oldParsed.references };
  const newEnvironment: Environment = { references: newParsed.references };
  const render = (source: string, environment: Environment) => renderer.render(source, environment as never);
  const rows: Row[] = [];

  const hiddenIfEmpty = (html: string, source: string, verb: string) =>
    textOf(html) === '' && !/<(img|hr|table|input)\b/i.test(html)
      ? `${/<!--/.test(source) ? 'HTML comment' : 'invisible content'} ${verb}`
      : undefined;

  const parts = diffArrays(oldParsed.blocks, newParsed.blocks, {
    comparator: (first, second) => first.source === second.source,
  });
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex]!;
    if (!part.added && !part.removed) {
      for (const block of part.value) rows.push({ type: 'unchanged', html: render(block.source, newEnvironment) });
      continue;
    }
    // Pair a removed run with the following added run block-by-block when kinds match.
    const removed = part.removed ? part.value : [];
    const nextPart = parts[partIndex + 1];
    let added = part.added ? part.value : [];
    if (part.removed && nextPart?.added) {
      added = nextPart.value;
      partIndex++;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let blockIndex = 0; blockIndex < Math.max(removed.length, added.length); blockIndex++) {
      const oldBlock = removed[blockIndex];
      const newBlock = added[blockIndex];
      if (
        blockIndex < pairs &&
        oldBlock &&
        newBlock &&
        oldBlock.kind === newBlock.kind &&
        similarity(oldBlock.source, newBlock.source) >= PAIRING_THRESHOLD
      ) {
        const oldHtml = render(oldBlock.source, oldEnvironment);
        const newHtml = render(newBlock.source, newEnvironment);
        if (textOf(oldHtml) === textOf(newHtml)) {
          rows.push({
            type: 'modified',
            html: newHtml,
            hiddenChange: describeHiddenChange(oldBlock.source, newBlock.source),
          });
          continue;
        }
        const inline = WORD_DIFF_KINDS.has(newBlock.kind)
          ? wordDiffHtml(renderer, oldBlock.source, newBlock.source, newEnvironment)
          : null;
        // Code blocks, tables, HTML (or a word diff that can't be placed safely): show both versions.
        if (inline) rows.push({ type: 'modified', html: inline });
        else rows.push({ type: 'removed', html: oldHtml }, { type: 'added', html: newHtml });
      } else {
        if (oldBlock) {
          const html = render(oldBlock.source, oldEnvironment);
          rows.push({ type: 'removed', html, hiddenChange: hiddenIfEmpty(html, oldBlock.source, 'removed') });
        }
        if (newBlock) {
          const html = render(newBlock.source, newEnvironment);
          rows.push({ type: 'added', html, hiddenChange: hiddenIfEmpty(html, newBlock.source, 'added') });
        }
      }
    }
  }

  const documentHiddenChanges: string[] = [];
  const referenceKeys = new Set([...Object.keys(oldParsed.references), ...Object.keys(newParsed.references)]);
  for (const key of referenceKeys) {
    const oldTarget = oldParsed.references[key]?.href;
    const newTarget = newParsed.references[key]?.href;
    if (oldTarget !== newTarget)
      documentHiddenChanges.push(`link reference [${key.toLowerCase()}]: ${oldTarget ?? '∅'} → ${newTarget ?? '∅'}`);
  }
  if (
    !rows.some(row => row.type !== 'unchanged') &&
    !documentHiddenChanges.length &&
    oldDocument.body !== newDocument.body
  )
    documentHiddenChanges.push('whitespace / blank-line change');
  const frontMatter = frontMatterRows(oldDocument.frontMatter, newDocument.frontMatter);
  if (
    oldDocument.frontMatter !== newDocument.frontMatter &&
    frontMatter &&
    frontMatter.every(row => row.type === 'unchanged')
  )
    documentHiddenChanges.push('front matter source changed (comments, quoting or key order)');

  return { frontMatter, rows, documentHiddenChanges };
}

/** Markdown-like files that get a rendered preview. */
export const isMarkdownPath = (path: string) => /\.(md|mdx|markdown|mdown|mkd)$/i.test(path);
