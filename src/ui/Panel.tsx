import { memo, useEffect, useMemo, useRef } from 'react';
import type { FileDiff, FileSummary, LineKind, PullRequest, ReviewSource } from '../shared/types.ts';
import { LINE_MARKERS, StatusLetter } from './Code.tsx';
import { Alert } from './components/Alert.tsx';
import { Button, buttonVariants } from './components/Button.tsx';
import { Checkbox } from './components/Checkbox.tsx';
import { Kbd } from './components/Kbd.tsx';
import { Skeleton } from './components/Skeleton.tsx';
import { isImagePath } from './data.ts';
import { ImageBody } from './ImageBody.tsx';
import { cleanHighlight } from './sanitize.ts';

// Plain strings per line kind: a large file renders thousands of these rows.
const CELL = 'align-top';
const NUMBER_CELL = `${CELL} w-[1%] px-1.5 text-right whitespace-nowrap select-none`;
const CODE_CELL = `${CELL} px-2.5 wrap-anywhere whitespace-pre-wrap`;
const NUMBER_CELL_STYLES: Record<LineKind, string> = {
  addition: `${NUMBER_CELL} bg-addition text-faint`,
  deletion: `${NUMBER_CELL} bg-deletion text-faint`,
  context: `${NUMBER_CELL} text-faint`,
  hunk: `${NUMBER_CELL} bg-fold text-muted`,
};
const CODE_CELL_STYLES: Record<LineKind, string> = {
  addition: `${CODE_CELL} bg-addition text-addition-foreground`,
  deletion: `${CODE_CELL} bg-deletion text-deletion-foreground`,
  context: CODE_CELL,
  hunk: `${CODE_CELL} bg-fold text-muted`,
};

export const DiffPanel = memo(function DiffPanel({
  file,
  diff,
  viewed,
  locked,
  githubUrl,
  source,
  pullRequest,
  onToggleViewed,
  onClose,
  onReachedEnd,
}: {
  file: FileSummary;
  diff: FileDiff | undefined;
  viewed: boolean;
  locked: boolean;
  githubUrl: string;
  source: ReviewSource;
  pullRequest: PullRequest;
  onToggleViewed: (path: string) => void;
  onClose: () => void;
  onReachedEnd: (path: string) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  // Unlock "Viewed" for large files once the user has actually scrolled through everything.
  // Scroll is reset first so a previous file's scroll position can never unlock this one.
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    element.scrollTop = 0;
    if (!diff?.complete) return;
    const checkReachedEnd = () => {
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 4) onReachedEnd(file.path);
    };
    checkReachedEnd();
    element.addEventListener('scroll', checkReachedEnd, { passive: true });
    return () => element.removeEventListener('scroll', checkReachedEnd);
  }, [diff, file.path, onReachedEnd]);
  const rows = useMemo(
    () =>
      diff?.lines.map((line, index) => (
        <tr key={index} data-kind={line.kind}>
          <td data-slot="line-number" className={NUMBER_CELL_STYLES[line.kind]}>
            {line.kind === 'hunk' ? '' : (line.oldNumber ?? '')}
          </td>
          <td data-slot="line-number" className={NUMBER_CELL_STYLES[line.kind]}>
            {line.kind === 'hunk' ? '' : (line.newNumber ?? '')}
          </td>
          <td className={CODE_CELL_STYLES[line.kind]}>
            {line.kind === 'hunk' ? (
              line.text
            ) : (
              <>
                {LINE_MARKERS[line.kind]}
                {line.html ? <span dangerouslySetInnerHTML={{ __html: cleanHighlight(line.html) }} /> : line.text}
              </>
            )}
          </td>
        </tr>
      )),
    [diff],
  );

  const nameStart = file.path.lastIndexOf('/') + 1;
  const changedLineCount = diff?.lines.filter(line => line.kind === 'addition' || line.kind === 'deletion').length;
  return (
    <aside
      data-slot="panel"
      className="absolute inset-y-0 right-0 z-10 grid w-[min(900px,80%)] grid-rows-[auto_1fr] border-l border-border bg-background shadow-[-12px_0_30px_var(--shadow)]"
      onClick={event => event.stopPropagation()}
    >
      <div className="flex items-center gap-2.5 border-b border-border bg-surface px-3.5 py-[9px]">
        <StatusLetter status={file.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
          <span className="text-muted">{file.path.slice(0, nameStart)}</span>
          {file.path.slice(nameStart)}
        </span>
        <label
          className="flex items-center gap-[5px] text-sm whitespace-nowrap"
          title={locked ? 'Scroll to the end first' : ''}
        >
          <Checkbox checked={viewed} disabled={locked && !viewed} onChange={() => onToggleViewed(file.path)} /> Viewed{' '}
          <Kbd>x</Kbd>
        </label>
        <a
          className={buttonVariants({ variant: 'outline', size: 'small' })}
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Comment on GitHub ↗
        </a>
        <Button size="small" onClick={onClose} title="Close (Esc)">
          ✕
        </Button>
      </div>
      <div data-slot="panel-body" className="overflow-auto" ref={body}>
        {!diff?.complete ? (
          <Skeleton />
        ) : diff.binary && isImagePath(file.path) ? (
          <ImageBody source={source} pullRequest={pullRequest} file={file} large />
        ) : diff.binary ? (
          <Alert>Binary file.</Alert>
        ) : (
          <table className="w-full border-collapse font-mono text-sm leading-[1.6]">
            <tbody>{rows}</tbody>
          </table>
        )}
        {diff?.warning && <Alert variant="warning">⚠ {diff.warning}</Alert>}
        {diff?.complete && (
          <div className="border-t border-dashed border-border px-3.5 py-2.5 text-sm text-muted">
            End of {file.path} · {changedLineCount} changed lines shown
          </div>
        )}
      </div>
    </aside>
  );
});
