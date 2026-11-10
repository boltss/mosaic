// "Same edit" grouping: files whose entire change is the same normalised edit.
import type { FileDiff } from '../shared/types.ts';

/** Normalise one changed line so trivially different instances of the same edit compare equal. */
export function normaliseLine(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(\.\.\/)+/g, '‹up›/')
    .replace(/\{[^{}]*\}(?=\s*from\b)/g, '{‹names›}');
}

/** Ordered list of normalised changed lines ("+…"/"-…"); null if the diff is not usable. */
export function signature(diff: FileDiff | undefined): string[] | null {
  if (!diff?.complete || diff.binary) return null;
  const changedLines = diff.lines
    .filter(line => line.kind === 'addition' || line.kind === 'deletion')
    .map(line => (line.kind === 'addition' ? '+' : '-') + normaliseLine(line.text));
  return changedLines.length ? changedLines : null;
}

export interface SameEditGroup {
  id: string;
  lines: string[];
  paths: string[];
}
/** A file that contains a group's whole edit plus `extraLines` other changed lines. */
export interface PartialMatch {
  groupId: string;
  extraLines: number;
}
export interface SameEditResult {
  groups: SameEditGroup[];
  groupByPath: Map<string, string>;
  partialMatches: Map<string, PartialMatch>;
}

const MINIMUM_FILES = 3;

/** Group candidate files (normally those still in Needs review) by identical signature. */
export function findSameEdits(candidates: string[], diffs: Map<string, FileDiff>): SameEditResult {
  const pathsBySignature = new Map<string, string[]>();
  const signatures = new Map<string, string[]>();
  for (const path of candidates) {
    const fileSignature = signature(diffs.get(path));
    if (!fileSignature) continue;
    signatures.set(path, fileSignature);
    const key = fileSignature.join('\n');
    pathsBySignature.set(key, [...(pathsBySignature.get(key) ?? []), path]);
  }
  const groups: SameEditGroup[] = [];
  const groupByPath = new Map<string, string>();
  for (const [key, paths] of pathsBySignature) {
    if (paths.length < MINIMUM_FILES) continue;
    const id = `group-${groups.length + 1}`;
    groups.push({ id, lines: key.split('\n'), paths });
    for (const path of paths) groupByPath.set(path, id);
  }
  // Files that contain a group's whole edit plus other changes: tag, keep in review.
  const partialMatches = new Map<string, PartialMatch>();
  for (const [path, fileSignature] of signatures) {
    if (groupByPath.has(path)) continue;
    for (const group of groups) {
      if (group.lines.length < 2 || fileSignature.length <= group.lines.length) continue;
      const remaining = new Map<string, number>();
      for (const line of fileSignature) remaining.set(line, (remaining.get(line) ?? 0) + 1);
      const containsWholeEdit = group.lines.every(line => {
        const count = remaining.get(line) ?? 0;
        remaining.set(line, count - 1);
        return count > 0;
      });
      if (containsWholeEdit) {
        partialMatches.set(path, { groupId: group.id, extraLines: fileSignature.length - group.lines.length });
        break;
      }
    }
  }
  return { groups, groupByPath, partialMatches };
}
