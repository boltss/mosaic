import type { DiffLine, FileDiff } from '../shared/types.ts';

const ESCAPE_CODES: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, a: 7, v: 11, '\\': 92, '"': 34 };

/** Undo git's C-style path quoting: "a/f\303\266o bar" -> a/föo bar */
export function unquoteGitPath(quotedPath: string): string {
  if (!quotedPath.startsWith('"')) return quotedPath;
  const body = quotedPath.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < body.length; index++) {
    const character = body[index]!;
    if (character !== '\\') {
      bytes.push(...new TextEncoder().encode(character));
      continue;
    }
    const escaped = body[index + 1]!;
    if (/[0-7]/.test(escaped)) {
      bytes.push(parseInt(body.slice(index + 1, index + 4), 8));
      index += 3;
    } else {
      bytes.push(ESCAPE_CODES[escaped] ?? escaped.charCodeAt(0));
      index += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const stripPrefix = (rawPath: string) => {
  const path = unquoteGitPath(rawPath.trim());
  return path === '/dev/null' ? null : path.replace(/^[ab]\//, '');
};

/** Parse a `git diff` / GitHub `.diff` into per-file diffs keyed by new path (old path for deletions). */
export function parseUnifiedDiff(text: string): Map<string, FileDiff> {
  const diffs = new Map<string, FileDiff>();
  const chunks = text.split(/^diff --git /m).slice(1);
  for (const chunk of chunks) {
    const rows = chunk.split('\n');
    let oldPath: string | null = null;
    let newPath: string | null = null;
    let binary = false;
    let renameFrom: string | null = null;
    let renameTo: string | null = null;
    let rowIndex = 1;
    for (; rowIndex < rows.length && !rows[rowIndex]!.startsWith('@@'); rowIndex++) {
      const row = rows[rowIndex]!;
      if (row.startsWith('--- ')) oldPath = stripPrefix(row.slice(4));
      else if (row.startsWith('+++ ')) newPath = stripPrefix(row.slice(4));
      else if (row.startsWith('rename from ')) renameFrom = unquoteGitPath(row.slice(12));
      else if (row.startsWith('rename to ')) renameTo = unquoteGitPath(row.slice(10));
      else if (row.startsWith('Binary files ')) binary = true;
    }
    let path = newPath ?? renameTo ?? oldPath ?? renameFrom;
    if (!path) {
      // No ---/+++ (mode-only change or pure rename): take it from the header "a/x b/x".
      const header = rows[0]!.match(/^(?:"?a\/)(.+?)"? "?b\/(.+?)"?$/);
      path = header ? header[2]! : rows[0]!;
    }
    const lines: DiffLine[] = [];
    let oldNumber = 0;
    let newNumber = 0;
    let oldRemaining = 0;
    let newRemaining = 0;
    for (; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]!;
      if (oldRemaining <= 0 && newRemaining <= 0) {
        const hunk = row.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (!hunk) continue; // "\ No newline at end of file", trailing blank, etc.
        oldNumber = Number(hunk[1]);
        oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
        newNumber = Number(hunk[3]);
        newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
        lines.push({ kind: 'hunk', text: row });
        continue;
      }
      if (row.startsWith('\\')) continue;
      if (row.startsWith('+')) {
        lines.push({ kind: 'addition', text: row.slice(1), newNumber: newNumber++ });
        newRemaining--;
      } else if (row.startsWith('-')) {
        lines.push({ kind: 'deletion', text: row.slice(1), oldNumber: oldNumber++ });
        oldRemaining--;
      } else {
        lines.push({ kind: 'context', text: row.slice(1), oldNumber: oldNumber++, newNumber: newNumber++ });
        oldRemaining--;
        newRemaining--;
      }
    }
    diffs.set(path, { path, lines, complete: true, binary, source: 'raw' });
  }
  return diffs;
}
