// The small pieces every diff view is built from: lines, folds, change counts, status letters.
import { memo, useMemo, type ComponentProps, type ReactNode } from 'react';
import { segments } from '../review/model.ts';
import type { DiffLine, FileDiff, FileStatus } from '../shared/types.ts';
import { Alert } from './components/Alert.tsx';
import { classNames } from './components/classNames.ts';
import { Kbd } from './components/Kbd.tsx';
import { cleanHighlight } from './sanitize.ts';

type ShownLineKind = 'addition' | 'deletion' | 'context';

// Plain strings, not merged per render: a big review shows a hundred thousand of these.
const LINE_LAYOUT = 'break-inside-avoid pr-2 pl-5 -indent-3 wrap-anywhere whitespace-pre-wrap';
const LINE_STYLES: Record<ShownLineKind, string> = {
  addition: `${LINE_LAYOUT} bg-addition text-addition-foreground`,
  deletion: `${LINE_LAYOUT} bg-deletion text-deletion-foreground`,
  context: `${LINE_LAYOUT} text-foreground opacity-[0.78]`,
};
export const LINE_MARKERS: Record<ShownLineKind, string> = { addition: '+', deletion: '−', context: ' ' };

export const DiffLineView = memo(function DiffLineView({ line }: { line: DiffLine }) {
  const kind: ShownLineKind = line.kind === 'hunk' ? 'context' : line.kind;
  return (
    <div data-slot="line" data-kind={kind} className={LINE_STYLES[kind]}>
      <span className="inline-block w-3 indent-0 opacity-70 select-none">{LINE_MARKERS[kind]}</span>
      {line.html ? <span dangerouslySetInnerHTML={{ __html: cleanHighlight(line.html) }} /> : line.text || ' '}
    </div>
  );
});

/** A block of diff lines in the code font; `wide` lays it out in two columns. */
export function CodeBlock({ wide = false, className, ...props }: ComponentProps<'div'> & { wide?: boolean }) {
  return (
    <div
      data-slot="code"
      className={classNames(
        'py-1 font-mono text-[length:var(--code-size)] leading-[1.5]',
        wide && 'columns-[2_460px] gap-x-0 [column-rule:1px_solid_var(--border-subtle)]',
        className,
      )}
      {...props}
    />
  );
}

/** Stands in for lines that are not shown; with `onExpand` it is a button that brings them back. */
export function FoldRow({ onExpand, children }: { onExpand?: () => void; children: ReactNode }) {
  return (
    <div
      data-slot={onExpand ? 'fold' : 'gap'}
      className={classNames(
        'my-0.5 break-inside-avoid bg-fold px-2 py-px font-[family-name:-apple-system,sans-serif] text-[10.5px] leading-[normal] text-fold-foreground',
        onExpand && 'cursor-pointer hover:underline',
      )}
      onClick={
        onExpand &&
        (event => {
          event.stopPropagation();
          onExpand();
        })
      }
    >
      {children}
    </div>
  );
}

/** A file's diff as code: every changed line, with long runs of unchanged context folded away. */
export function DiffCode({
  diff,
  expanded,
  onExpand,
  wide,
}: {
  diff: FileDiff;
  /** Folds the reader has opened, by the index of their first line. */
  expanded: Set<number>;
  onExpand: (start: number) => void;
  wide?: boolean;
}) {
  const parts = useMemo(() => segments(diff.lines), [diff]);
  if (diff.binary) return <Alert>Binary file — nothing to show inline.</Alert>;
  if (!diff.lines.length) return <Alert>No line changes (mode or rename only).</Alert>;
  return (
    <CodeBlock wide={wide}>
      {parts.map((part, partIndex) => {
        if ('line' in part) return <DiffLineView key={partIndex} line={part.line} />;
        if ('gap' in part)
          return (
            <FoldRow key={partIndex}>⋯ {part.gap.text.replace(/^@@ [^@]+ @@\s*/, '') || 'unchanged lines'}</FoldRow>
          );
        const [start, end] = part.fold;
        if (expanded.has(start))
          return diff.lines
            .slice(start, end)
            .map((line, offset) => <DiffLineView key={`${partIndex}-${offset}`} line={line} />);
        return (
          <FoldRow key={partIndex} onExpand={() => onExpand(start)}>
            ⋯ {end - start} unchanged line{end - start > 1 ? 's' : ''} — expand
          </FoldRow>
        );
      })}
    </CodeBlock>
  );
}

/** "+12 −3" */
export function ChangeCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="flex-none font-mono text-xs leading-[normal] whitespace-nowrap">
      <span className="text-success">+{additions}</span>
      <span className="ml-[3px] text-danger">−{deletions}</span>
    </span>
  );
}

const STATUS_LETTERS: Record<FileStatus, string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };
const STATUS_STYLES: Record<FileStatus, string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-highlight',
};

export function StatusLetter({ status }: { status: FileStatus }) {
  return (
    <span
      className={classNames(
        'w-3.5 flex-none text-center font-mono text-2xs leading-[normal] font-semibold',
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LETTERS[status]}
    </span>
  );
}

const LEGEND_ENTRIES = [
  { style: 'bg-success', key: 'added' },
  { style: 'bg-warning', key: 'changed' },
  { style: 'bg-danger', key: 'removed' },
] as const;

/** Explains the colours of a preview and how to get back to the code. */
export function Legend({ addedLabel = 'added' }: { addedLabel?: string }) {
  return (
    <div className="flex flex-wrap gap-3 border-b border-subtle px-3 py-1 text-xs text-muted">
      {LEGEND_ENTRIES.map(entry => (
        <span key={entry.key}>
          <i className={classNames('mr-1 inline-block size-2 rounded-xs', entry.style)} />
          {entry.key === 'added' ? addedLabel : entry.key}
        </span>
      ))}
      <span className="ml-auto">
        <Kbd>p</Kbd> code view
      </span>
    </div>
  );
}
