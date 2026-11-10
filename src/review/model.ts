// Pure helpers for presenting a pull request: context folding, progress weighting, folder tree.
import type { DiffLine, FileSummary } from '../shared/types.ts';

export type Segment = { line: DiffLine; index: number } | { fold: [start: number, end: number] } | { gap: DiffLine };

/**
 * Every added/removed line is always kept. Runs of unchanged context longer than twice
 * `contextSize` (+1) fold into one {fold} row; hunk headers become {gap} separators.
 */
export function segments(lines: DiffLine[], contextSize = 2): Segment[] {
  const result: Segment[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind === 'hunk') {
      if (index > 0) result.push({ gap: line });
      index++;
      continue;
    }
    if (line.kind !== 'context') {
      result.push({ line, index });
      index++;
      continue;
    }
    let runEnd = index;
    while (runEnd < lines.length && lines[runEnd]!.kind === 'context') runEnd++;
    const atStart = index === 0 || lines[index - 1]!.kind === 'hunk';
    const atEnd = runEnd === lines.length || lines[runEnd]!.kind === 'hunk';
    const before = atStart ? 0 : contextSize;
    const after = atEnd ? 0 : contextSize;
    const keep = (from: number, to: number) => {
      for (let position = from; position < to; position++) result.push({ line: lines[position]!, index: position });
    };
    if (runEnd - index > before + after + 1) {
      keep(index, index + before);
      result.push({ fold: [index + before, runEnd - after] });
      keep(runEnd - after, runEnd);
    } else {
      keep(index, runEnd);
    }
    index = runEnd;
  }
  return result;
}

export const changedLines = (file: FileSummary) => file.additions + file.deletions;
/** Progress weight: changed lines, at least 1 so pure renames still count. */
export const weight = (file: FileSummary) => Math.max(1, changedLines(file));

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  /** All file paths under this node (recursive). */
  files: string[];
}

interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  ownFiles: string[];
}

/** Folder tree with single-child chains compressed ("apps/mobile/src"). */
export function buildTree(paths: string[]): TreeNode {
  const root: Folder = { name: '', path: '', folders: new Map(), ownFiles: [] };
  for (const path of paths) {
    const folderNames = path.split('/').slice(0, -1);
    let folder = root;
    folderNames.forEach((name, depth) => {
      if (!folder.folders.has(name))
        folder.folders.set(name, {
          name,
          path: folderNames.slice(0, depth + 1).join('/'),
          folders: new Map(),
          ownFiles: [],
        });
      folder = folder.folders.get(name)!;
    });
    folder.ownFiles.push(path);
  }
  const toNode = (folder: Folder, isRoot: boolean): TreeNode => {
    let { name, path, folders, ownFiles } = folder;
    // The root is never merged into its only child.
    while (folders.size === 1 && ownFiles.length === 0) {
      if (isRoot) break;
      const onlyChild = [...folders.values()][0]!;
      name += '/' + onlyChild.name;
      path = onlyChild.path;
      folders = onlyChild.folders;
      ownFiles = onlyChild.ownFiles;
    }
    const children = [...folders.values()]
      .toSorted((first, second) => first.name.localeCompare(second.name))
      .map(child => toNode(child, false));
    return { name, path, children, files: ownFiles.concat(...children.map(child => child.files)) };
  };
  return toNode(root, true);
}

export const directoryOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Stable display order: by directory, then file name. Root files ('' directory) first. */
export function sortFiles<File extends { path: string }>(files: File[]): File[] {
  return files.toSorted((first, second) => {
    const firstDirectory = directoryOf(first.path);
    const secondDirectory = directoryOf(second.path);
    return firstDirectory === secondDirectory
      ? first.path.localeCompare(second.path)
      : firstDirectory.localeCompare(secondDirectory);
  });
}
