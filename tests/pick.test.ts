import { describe, expect, test } from 'bun:test';
import { pickDiff } from '../src/ui/data.ts';
import type { FileDiff, FileSummary } from '../src/shared/types.ts';

const file: FileSummary = { path: 'a.ts', status: 'modified', additions: 2, deletions: 1, viewed: false };
const diff = (spec: string, overrides: Partial<FileDiff> = {}): FileDiff => ({
  path: 'a.ts',
  complete: true,
  source: 'entries',
  lines: [...spec].map(marker => ({
    kind: marker === '+' ? 'addition' : marker === '-' ? 'deletion' : 'context',
    text: marker,
  })),
  ...overrides,
});

describe('pickDiff never shows fewer lines silently', () => {
  test('complete entry with matching counts wins', () => {
    const entryDiff = diff('++-');
    expect(pickDiff(file, entryDiff, diff('++-', { source: 'raw' }), true)).toBe(entryDiff);
  });
  test('entry missing lines falls back to the raw diff', () => {
    const rawDiff = diff('++- ', { source: 'raw' });
    expect(pickDiff(file, diff('+-'), rawDiff, true)!.source).toBe('raw');
  });
  test('waits for the raw diff instead of showing a mismatching entry', () => {
    expect(pickDiff(file, diff('+-'), undefined, false)!.complete).toBe(false);
  });
  test('neither matches: show the raw diff with a visible warning', () => {
    const picked = pickDiff(file, diff('+-'), diff('+', { source: 'raw' }), true)!;
    expect(picked.complete).toBe(true);
    expect(picked.warning).toContain('GitHub reports +2 −1');
  });
  test('truncated entry and no raw diff: stays incomplete', () => {
    expect(pickDiff(file, diff('+', { complete: false }), undefined, true)!.complete).toBe(false);
  });
  test('cache returns the same object for the same inputs', () => {
    const cache = new WeakMap();
    const rawDiff = diff('++-', { source: 'raw' });
    const entryDiff = diff('+', { complete: false });
    expect(pickDiff(file, entryDiff, rawDiff, true, cache)).toBe(pickDiff(file, entryDiff, rawDiff, true, cache)!);
  });
});
