import { useMemo, useState } from 'react';
import { testOutline, type OutlineRow } from '../review/testOutline.ts';
import type { FileDiff, FileSummary, PullRequest, ReviewSource } from '../shared/types.ts';
import { CodeBlock, DiffCode, DiffLineView, Legend } from './Code.tsx';
import { classNames } from './components/classNames.ts';
import { useFileContent } from './data.ts';

const STATE_BORDERS: Record<OutlineRow['state'], string> = {
  added: 'border-success',
  changed: 'border-warning',
  removed: 'border-danger',
  unchanged: 'border-transparent',
};

/** `wholeFile`: the file itself was added or deleted, so no single row stands out as changed. */
function nameStyle(row: OutlineRow, wholeFile: boolean): string {
  const unnamed = row.kind === 'hook' || row.kind === 'setup' || row.kind === 'rest';
  const color =
    !wholeFile && row.state === 'removed'
      ? 'text-muted line-through'
      : !wholeFile && row.state === 'unchanged'
        ? 'text-faint'
        : unnamed
          ? 'text-muted'
          : '';
  return classNames(
    'min-w-0 flex-1 wrap-anywhere',
    row.kind === 'group' && 'font-semibold',
    unnamed && 'italic',
    color,
  );
}

/** A test file as a list of its test names; each row opens to the lines it stands for. */
export function TestOutline({
  source,
  pullRequest,
  file,
  diff,
}: {
  source: ReviewSource;
  pullRequest: PullRequest;
  file: FileSummary;
  diff: FileDiff;
}) {
  const wholeFile = file.status === 'added' || file.status === 'deleted';
  const outlineFromDiff = useMemo(() => testOutline(diff.lines), [diff]);
  // Changes deep inside an unchanged test can only be named from the whole file.
  const needsFileContent = !wholeFile && !!outlineFromDiff?.some(row => row.kind === 'rest');
  const content = useFileContent(source, pullRequest, file.path, 'new', needsFileContent).data;
  const rows = useMemo(
    () => (content ? testOutline(diff.lines, content) : outlineFromDiff),
    [diff, content, outlineFromDiff],
  );
  const [toggled, setToggled] = useState<Set<number>>(new Set());
  if (!rows) return <DiffCode diff={diff} expanded={new Set()} onExpand={() => {}} />;
  const toggle = (start: number) =>
    setToggled(current => {
      const next = new Set(current);
      if (!next.delete(start)) next.add(start);
      return next;
    });
  return (
    <>
      {!wholeFile && <Legend addedLabel="new" />}
      <div data-slot="outline" className="py-1">
        {rows.map(row => {
          // Rows without a test name can't be judged from the list, so they start open.
          const open = (row.kind === 'setup' || row.kind === 'rest') !== toggled.has(row.start);
          const lineCount = row.end - row.start;
          return (
            <div
              key={row.start}
              className={classNames('border-l-[3px]', wholeFile ? 'border-transparent' : STATE_BORDERS[row.state])}
            >
              <div
                data-slot="outline-row"
                data-kind={row.kind}
                className="flex cursor-pointer break-inside-avoid items-baseline gap-[5px] py-0.5 pr-2 text-sm leading-[1.4] hover:bg-hover"
                style={{ paddingLeft: 6 + row.depth * 12 }}
                title={open ? 'Hide the code' : 'Show the code'}
                onClick={event => {
                  event.stopPropagation();
                  toggle(row.start);
                }}
              >
                <span className="w-[9px] flex-none text-3xs text-faint">{open ? '▾' : '▸'}</span>
                <span data-slot="outline-name" className={nameStyle(row, wholeFile)}>
                  {row.name}
                  {row.previousName && (
                    <s className="ml-1.5 text-faint" title="Removed in the same edit">
                      {row.previousName}
                    </s>
                  )}
                </span>
                {wholeFile || row.state === 'unchanged' ? (
                  <span className="flex-none text-[10.5px] leading-[normal] text-faint">
                    {lineCount} line{lineCount > 1 ? 's' : ''}
                  </span>
                ) : (
                  <span className="flex flex-none gap-1 font-mono text-[10.5px] leading-[normal]">
                    {row.additions > 0 && <span className="text-success">+{row.additions}</span>}
                    {row.deletions > 0 && <span className="text-danger">−{row.deletions}</span>}
                  </span>
                )}
              </div>
              {open && (
                <CodeBlock className="mb-1 border-y border-subtle bg-background">
                  {diff.lines.slice(row.start, row.end).map((line, offset) => (
                    <DiffLineView key={offset} line={line} />
                  ))}
                </CodeBlock>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
