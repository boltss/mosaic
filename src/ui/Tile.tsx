import { Component, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BUCKETS } from '../review/classify.ts';
import { changedLines } from '../review/model.ts';
import type { FileDiff, FileSummary, PullRequest, ReviewSource } from '../shared/types.ts';
import { ChangeCounts, DiffCode, StatusLetter } from './Code.tsx';
import { Alert } from './components/Alert.tsx';
import { Badge } from './components/Badge.tsx';
import { Button } from './components/Button.tsx';
import { Checkbox } from './components/Checkbox.tsx';
import { classNames } from './components/classNames.ts';
import { Kbd } from './components/Kbd.tsx';
import { Skeleton } from './components/Skeleton.tsx';
import { ToggleGroup } from './components/ToggleGroup.tsx';
import { isImagePath, type Classified, type DiffState } from './data.ts';
import { ImageBody } from './ImageBody.tsx';
import { MarkdownPreview } from './MarkdownPreview.tsx';
import type { ViewMode } from './settings.ts';
import { TestOutline } from './TestOutline.tsx';

/** Changed lines above which a tile takes the full row, and above which a file must be read in the panel. */
export const WIDE_THRESHOLD = 40;
export const LARGE_THRESHOLD = 300;

// One ResizeObserver for all tiles: packs them into a masonry grid of 2px rows.
const GRID_ROW_HEIGHT = 2;
const GRID_GAP = 8;
const masonryObserver =
  typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(entries => {
        // Read sizes from the observer entries (no forced layout), then write.
        const heights = entries.map(
          entry =>
            [entry.target as HTMLElement, entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height] as const,
        );
        for (const [element, height] of heights)
          element.style.gridRowEnd = `span ${Math.max(1, Math.ceil((height + GRID_GAP) / GRID_ROW_HEIGHT))}`;
      })
    : null;

/** Keeps a broken tile (e.g. odd markdown) from taking the whole review down. */
export class TileBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <Alert variant="warning">This tile failed to render ({this.state.error}). Open it on GitHub.</Alert>
    ) : (
      this.props.children
    );
  }
}

/** A note with a button that opens the file in the diff panel. */
function OpenNote({
  variant,
  label = 'Open',
  onOpen,
  children,
}: {
  variant?: 'warning';
  label?: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <Alert variant={variant}>
      {children}{' '}
      <Button
        className="ml-1.5"
        onClick={event => {
          event.stopPropagation();
          onOpen();
        }}
      >
        {label}
      </Button>
    </Alert>
  );
}

export interface TileProps {
  file: FileSummary;
  diff: FileDiff | undefined;
  diffState: DiffState;
  classification: Classified;
  viewed: boolean;
  focused: boolean;
  locked: boolean;
  isMarkdown: boolean;
  isTest: boolean;
  viewMode: ViewMode;
  source: ReviewSource;
  pullRequest: PullRequest;
  onToggleViewed: (path: string) => void;
  onOpen: (path: string) => void;
  onFocus: (path: string) => void;
  onViewModeChange: (path: string, mode: ViewMode) => void;
  onRetry: () => void;
}

export const Tile = memo(function Tile(props: TileProps) {
  const { file, diff, classification, viewed, focused, locked, viewMode, onViewModeChange } = props;
  // Stable, so the preview's fall-back effect fires once rather than on every render.
  const showCode = useCallback(() => onViewModeChange(file.path, 'code'), [onViewModeChange, file.path]);
  const ref = useRef<HTMLDivElement>(null);
  const [expandedFolds, setExpandedFolds] = useState<Set<number>>(new Set());
  const [markdownFoldsOpen, setMarkdownFoldsOpen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element && masonryObserver) {
      masonryObserver.observe(element);
      return () => masonryObserver.unobserve(element);
    }
  }, []);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  const changed = changedLines(file);
  const bucket = BUCKETS.find(candidate => candidate.id === classification.id)!;
  const hasPreview = props.isMarkdown || props.isTest;
  // Test files are read from their outline (or as code on request), whatever their size.
  const large = changed > LARGE_THRESHOLD && !props.isTest;
  const lockfile = classification.id === 'lockfile';
  const collapsed = large && classification.id !== 'review';
  const wide = changed > WIDE_THRESHOLD && !lockfile && !collapsed && !(hasPreview && viewMode === 'preview');
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  const open = () => props.onOpen(file.path);

  let body: ReactNode;
  if (lockfile)
    body = (
      <OpenNote onOpen={open}>
        Lockfile, {changed.toLocaleString()} changed line{changed === 1 ? '' : 's'} hidden.
      </OpenNote>
    );
  else if (collapsed)
    body = (
      <OpenNote onOpen={open}>
        {changed.toLocaleString()} changed lines, collapsed ({bucket.label.toLowerCase()}).
      </OpenNote>
    );
  else if (large && locked)
    body = (
      <OpenNote variant="warning" onOpen={open}>
        Large file: {changed.toLocaleString()} changed lines. Open it (<Kbd>↵</Kbd>) and scroll to the end to unlock
        “Viewed”.
      </OpenNote>
    );
  else if (large)
    body = (
      <OpenNote label="Open again" onOpen={open}>
        Large file reviewed in the panel.
      </OpenNote>
    );
  else if (props.isMarkdown && viewMode === 'preview' && diff?.complete)
    body = (
      <MarkdownPreview
        source={props.source}
        pullRequest={props.pullRequest}
        file={file}
        onShowCode={showCode}
        foldsOpen={markdownFoldsOpen}
        onOpenFolds={() => setMarkdownFoldsOpen(true)}
      />
    );
  else if (props.isTest && viewMode === 'preview' && diff?.complete && !diff.warning)
    body = <TestOutline source={props.source} pullRequest={props.pullRequest} file={file} diff={diff} />;
  else if (diff?.complete && diff.binary && isImagePath(file.path))
    body = <ImageBody source={props.source} pullRequest={props.pullRequest} file={file} />;
  else if (diff?.complete)
    body = (
      <>
        {diff.warning && <Alert variant="warning">⚠ {diff.warning}</Alert>}
        <DiffCode
          diff={diff}
          wide={wide}
          expanded={expandedFolds}
          onExpand={start => setExpandedFolds(current => new Set(current).add(start))}
        />
      </>
    );
  else if (props.diffState === 'error')
    body = (
      <Alert variant="warning">
        Couldn't load this diff.{' '}
        <Button
          className="ml-1.5"
          onClick={event => {
            event.stopPropagation();
            props.onRetry();
          }}
        >
          Retry
        </Button>
      </Alert>
    );
  else body = <Skeleton title={diff ? 'GitHub truncated this diff; loading the full version…' : 'Loading…'} />;

  const badge =
    classification.extraLines != null ? (
      <Badge color="var(--info)" title="Contains a shared edit plus other changes">
        same edit +{classification.extraLines}
      </Badge>
    ) : bucket.pill ? (
      <Badge color={bucket.color} title={classification.reason}>
        {bucket.pill}
      </Badge>
    ) : null;

  return (
    <div
      ref={ref}
      data-slot="tile"
      data-path={file.path}
      data-viewed={viewed || undefined}
      data-focused={focused || undefined}
      data-wide={wide || undefined}
      className={classNames(
        'mb-2 self-start overflow-clip rounded-lg border border-border bg-background',
        wide && 'col-span-full',
        viewed && 'opacity-50',
        focused ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'hover:border-faint',
      )}
      onClick={() => props.onFocus(file.path)}
      onDoubleClick={open}
    >
      {/* Sticks under the folder header so the checkbox follows the scroll. */}
      <div
        data-slot="tile-header"
        className="sticky top-(--section-header-height) z-1 flex cursor-pointer items-center gap-1.5 bg-surface px-2 py-[5px] text-sm"
        title={file.path}
      >
        <Checkbox
          checked={viewed}
          disabled={locked && !viewed}
          title={
            locked
              ? props.diffState === 'ready'
                ? 'Open and scroll to the end first'
                : 'Available once the diff has loaded'
              : 'Viewed (x)'
          }
          onClick={event => event.stopPropagation()}
          onChange={() => props.onToggleViewed(file.path)}
        />
        <StatusLetter status={file.status} />
        <span className={classNames('min-w-0 flex-1 truncate font-medium', viewed && 'line-through')}>{name}</span>
        {badge}
        {hasPreview && !large && !lockfile && (
          <ToggleGroup
            size="small"
            options={[
              { value: 'preview', label: props.isTest ? 'Tests' : 'Preview' },
              { value: 'code', label: 'Code' },
            ]}
            value={viewMode}
            onValueChange={mode => onViewModeChange(file.path, mode)}
            onClick={event => event.stopPropagation()}
          />
        )}
        <ChangeCounts additions={file.additions} deletions={file.deletions} />
      </div>
      {/* A viewed file is collapsed to its header: its diff isn't built at all. */}
      {!viewed && (
        // Off-screen diffs skip layout and paint. Without this a 200-file review repaints 100k nodes per frame.
        <div
          className="[content-visibility:auto]"
          style={{ containIntrinsicSize: `auto ${Math.min(changed, 400) * 16 + 12}px` }}
        >
          <TileBoundary>{body}</TileBoundary>
        </div>
      )}
    </div>
  );
});
