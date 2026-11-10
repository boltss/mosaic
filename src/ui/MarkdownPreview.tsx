import { useEffect, useMemo, type ReactNode } from 'react';
import {
  diffMarkdown,
  type ChangeType,
  type FrontMatterRow,
  type MarkdownDiff,
  type Row,
} from '../markdown/markdownDiff.ts';
import type { FileSummary, PullRequest, ReviewSource } from '../shared/types.ts';
import { FoldRow, Legend } from './Code.tsx';
import { Alert } from './components/Alert.tsx';
import { Button } from './components/Button.tsx';
import { classNames } from './components/classNames.ts';
import { Skeleton } from './components/Skeleton.tsx';
import { useFileContent } from './data.ts';
import { cleanMarkdown } from './sanitize.ts';

const BLOCK_STYLES: Record<ChangeType, string> = {
  unchanged: 'border-transparent',
  added: 'border-success bg-success/9',
  modified: 'border-warning bg-warning/8',
  removed: 'border-danger bg-danger/8',
};

function HiddenChangeBadge({ description, onShowCode }: { description: string; onShowCode: () => void }) {
  return (
    <Button
      variant="warning"
      onClick={event => {
        event.stopPropagation();
        onShowCode();
      }}
    >
      ⚠ hidden change: {description}
    </Button>
  );
}

function MarkdownBlock({ row, onShowCode, newFile }: { row: Row; onShowCode: () => void; newFile: boolean }) {
  // In a new file everything is added, so marking each block would only be noise.
  const change: ChangeType = newFile ? 'unchanged' : row.type;
  return (
    <div
      data-slot="markdown-block"
      data-change={change}
      className={classNames('relative -mx-3.5 border-l-[3px] px-3.5 py-px', BLOCK_STYLES[change])}
    >
      {change === 'added' && <span className="absolute top-[3px] right-2 text-2xs text-muted">added</span>}
      {row.type === 'removed' && <span className="absolute top-[3px] right-2 text-2xs text-muted">removed</span>}
      <div
        className={classNames(change === 'removed' && 'line-through decoration-danger/60 opacity-80')}
        dangerouslySetInnerHTML={{ __html: cleanMarkdown(row.html) }}
      />
      {row.hiddenChange && <HiddenChangeBadge description={row.hiddenChange} onShowCode={onShowCode} />}
    </div>
  );
}

const FRONT_MATTER_VALUE_STYLES: Record<ChangeType, string> = {
  unchanged: '',
  added: 'text-success',
  modified: 'text-warning',
  removed: 'text-danger line-through',
};

function FrontMatterTable({ rows, newFile }: { rows: FrontMatterRow[]; newFile: boolean }) {
  return (
    <table data-slot="front-matter" className="my-1 border-collapse text-[11.5px]">
      <tbody>
        {rows.map(row => {
          const change: ChangeType = newFile ? 'unchanged' : row.type;
          return (
            <tr key={row.key}>
              <td
                className={classNames(
                  'py-px pr-2.5 pl-0 align-top',
                  change === 'removed' ? FRONT_MATTER_VALUE_STYLES.removed : 'text-muted',
                )}
              >
                {row.key}
              </td>
              <td className={classNames('py-px pr-2.5 pl-0 align-top', FRONT_MATTER_VALUE_STYLES[change])}>
                {row.type === 'removed'
                  ? row.oldValue
                  : row.type === 'modified'
                    ? `${row.oldValue} → ${row.value}`
                    : row.value}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Keeps every changed row; folds runs of unchanged rows, leaving one neighbour on each side. */
function MarkdownBody({
  diff,
  file,
  onShowCode,
  foldsOpen,
  onOpenFolds,
}: {
  diff: MarkdownDiff;
  file: FileSummary;
  onShowCode: () => void;
  foldsOpen: boolean;
  onOpenFolds: () => void;
}) {
  const newFile = file.status === 'added';
  const { rows } = diff;
  const block = (index: number) => (
    <MarkdownBlock key={index} row={rows[index]!} onShowCode={onShowCode} newFile={newFile} />
  );
  const items: ReactNode[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (!foldsOpen && !newFile && rows[index]!.type === 'unchanged') {
      let runEnd = index;
      while (runEnd < rows.length && rows[runEnd]!.type === 'unchanged') runEnd++;
      const keepAtStart = index === 0 ? 0 : 1;
      const keepAtEnd = runEnd === rows.length ? 0 : 1;
      if (runEnd - index > keepAtStart + keepAtEnd + 1) {
        for (let kept = index; kept < index + keepAtStart; kept++) items.push(block(kept));
        items.push(
          <FoldRow key={`fold-${index}`} onExpand={onOpenFolds}>
            ⋯ {runEnd - index - keepAtStart - keepAtEnd} unchanged sections — expand
          </FoldRow>,
        );
        for (let kept = runEnd - keepAtEnd; kept < runEnd; kept++) items.push(block(kept));
        index = runEnd - 1;
        continue;
      }
    }
    items.push(block(index));
  }
  return (
    <>
      {!newFile && <Legend />}
      <div data-slot="markdown" className="markdown">
        {diff.documentHiddenChanges.map(description => (
          <HiddenChangeBadge key={description} description={description} onShowCode={onShowCode} />
        ))}
        {diff.frontMatter && <FrontMatterTable rows={diff.frontMatter} newFile={newFile} />}
        {items}
        {!rows.length && !diff.frontMatter && <Alert>Empty document.</Alert>}
      </div>
    </>
  );
}

/** Turn a link or image target written relative to `directory` into a repository path. */
function resolveRepositoryPath(directory: string, target: string): string {
  const resolved: string[] = [];
  for (const part of ((target.startsWith('/') ? '' : directory) + target).split('/')) {
    if (part === '..') resolved.pop();
    else if (part && part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

/** A markdown file rendered the way it reads, with what changed marked block by block. */
export function MarkdownPreview({
  source,
  pullRequest,
  file,
  onShowCode,
  foldsOpen,
  onOpenFolds,
}: {
  source: ReviewSource;
  pullRequest: PullRequest;
  file: FileSummary;
  /** Switch this file to its plain diff: asked for by a hidden-change badge, or because the preview failed. */
  onShowCode: () => void;
  foldsOpen: boolean;
  onOpenFolds: () => void;
}) {
  const hasOldSide = file.status !== 'added';
  const hasNewSide = file.status !== 'deleted';
  const oldContent = useFileContent(source, pullRequest, file.path, 'old', hasOldSide);
  const newContent = useFileContent(source, pullRequest, file.path, 'new', hasNewSide);
  const ready = (!hasOldSide || oldContent.isSuccess) && (!hasNewSide || newContent.isSuccess);
  // A side that must exist but came back missing (e.g. unknown old path of a rename) would hide content: fall back to code.
  const missing =
    (hasOldSide && oldContent.isSuccess && oldContent.data == null) ||
    (hasNewSide && newContent.isSuccess && newContent.data == null);
  const failed = oldContent.isError || newContent.isError || missing;
  const diff = useMemo(() => {
    if (!ready) return null;
    const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : '';
    return diffMarkdown(oldContent.data ?? null, newContent.data ?? null, {
      resolve: (target, kind) => {
        const [pathPart, hash] = target.split('#');
        const url = source.blobUrl(
          pullRequest,
          resolveRepositoryPath(directory, pathPart!),
          kind === 'image' ? 'raw' : 'blob',
        );
        return hash ? `${url}#${hash}` : url;
      },
    });
  }, [ready, oldContent.data, newContent.data, file.path, source, pullRequest]);
  useEffect(() => {
    if (failed) onShowCode();
  }, [failed, onShowCode]);
  if (failed) return <Alert variant="warning">Preview unavailable — showing code.</Alert>;
  if (!diff) return <Skeleton />;
  return (
    <MarkdownBody diff={diff} file={file} onShowCode={onShowCode} foldsOpen={foldsOpen} onOpenFolds={onOpenFolds} />
  );
}
