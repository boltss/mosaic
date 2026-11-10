import type { ReactNode, Ref } from 'react';
import { LOGO_TILES, type Approval, type PullRequest, type ReviewStatus } from '../shared/types.ts';
import { Button, buttonVariants } from './components/Button.tsx';
import { Checkbox } from './components/Checkbox.tsx';
import { classNames } from './components/classNames.ts';
import { Input } from './components/Input.tsx';
import { Progress } from './components/Progress.tsx';
import { ToggleGroup } from './components/ToggleGroup.tsx';
import { DENSITIES, DENSITY_ORDER, type Density } from './settings.ts';

const LOGO_COLORS = ['var(--primary)', 'var(--success)', 'var(--highlight)'];

export function Logo() {
  return (
    <span className="inline-flex items-center gap-1.5 font-bold whitespace-nowrap text-primary">
      <svg className="size-3.5 flex-none" viewBox="0 0 16 16" aria-hidden="true">
        {LOGO_TILES.map((tile, index) => (
          <rect
            key={index}
            x={tile.left}
            y={tile.top}
            width={tile.width}
            height={tile.height}
            rx={1.5}
            fill={LOGO_COLORS[index]}
          />
        ))}
      </svg>
      Mosaic
    </span>
  );
}

/** The bar across the top; also used on its own, with just the logo and a close button, while loading. */
export function TopBarFrame({ children }: { children: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border bg-surface px-3.5 py-[9px]">
      {children}
    </header>
  );
}

export function TopBarTitle({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-[1_1_280px] items-baseline gap-2">
      <Logo />
      {children}
    </div>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="large" onClick={onClose} title="Close (Esc)">
      ✕
    </Button>
  );
}

const DENSITY_OPTIONS = DENSITY_ORDER.map(density => ({ value: density, label: DENSITIES[density].label }));

export interface ReviewProgress {
  /** Share of changed lines marked viewed, 0–100. */
  percent: number;
  viewedFiles: number;
  totalFiles: number;
  needingReview: number;
  /** Diffs settled so far; null once every diff has loaded. */
  loadedFiles: number | null;
}

export interface ApprovalProps {
  status: ReviewStatus | undefined;
  /** Commits were pushed after the files were loaded, so approving would cover code nobody saw. */
  headMoved: boolean;
  submitting: boolean;
  onApprove: () => void;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Who has approved the current head; earlier-commit approvals are only in the tooltip. */
function Approvals({ approvals }: { approvals: Approval[] }) {
  const current = approvals
    .filter(approval => !approval.stale)
    .toSorted((first, second) => Number(second.isViewer) - Number(first.isViewer));
  if (!current.length) return null;
  const names = current.map(approval => (approval.isViewer ? 'you' : approval.login));
  const title = approvals
    .map(
      approval => `${approval.isViewer ? 'You' : approval.login} approved${approval.stale ? ' an earlier commit' : ''}`,
    )
    .join('\n');
  return (
    <span data-slot="approvals" className="text-sm whitespace-nowrap text-success" title={title}>
      ✓ Approved by {names.slice(0, 2).join(', ')}
      {names.length > 2 && ` +${names.length - 2}`}
    </span>
  );
}

/** Submits a GitHub approval; locked until every file is marked viewed. Hidden once the viewer has approved. */
function ApproveButton({ progress, approval }: { progress: ReviewProgress; approval: ApprovalProps }) {
  const { status, headMoved, submitting } = approval;
  if (status && (!status.canApprove || status.approvals.some(given => given.isViewer && !given.stale))) return null;
  const remaining = progress.totalFiles - progress.viewedFiles;
  const ready = !!status && remaining === 0 && progress.loadedFiles == null && !headMoved && !submitting;
  const [label, title] = submitting
    ? ['Approving…', 'Submitting your approval to GitHub']
    : headMoved
      ? ['New commits: reopen to approve', 'Commits were pushed after Mosaic loaded this pull request']
      : remaining > 0
        ? [`Approve · ${remaining} left`, `Mark the remaining ${plural(remaining, 'file')} viewed to approve`]
        : ready
          ? ['✓ Approve pull request', 'Submit an approving review on GitHub']
          : ['Approve', 'Waiting for every diff to load'];
  return (
    <Button
      variant="approve"
      data-slot="approve-pull-request"
      className="disabled:border-border disabled:bg-transparent disabled:font-normal disabled:text-muted"
      disabled={!ready}
      title={title}
      onClick={approval.onApprove}
    >
      {label}
    </Button>
  );
}

export function TopBar({
  pullRequest,
  progress,
  approval,
  timeChip,
  filter,
  onFilterChange,
  filterRef,
  density,
  onDensityChange,
  hideViewed,
  onHideViewedChange,
  githubUrl,
  onClose,
}: {
  pullRequest: PullRequest;
  progress: ReviewProgress;
  approval: ApprovalProps;
  timeChip: ReactNode;
  filter: string;
  onFilterChange: (filter: string) => void;
  filterRef: Ref<HTMLInputElement>;
  density: Density;
  onDensityChange: (density: Density) => void;
  hideViewed: boolean;
  onHideViewedChange: (hideViewed: boolean) => void;
  githubUrl: string;
  onClose: () => void;
}) {
  return (
    <TopBarFrame>
      <TopBarTitle>
        <span className="whitespace-nowrap text-muted">
          {pullRequest.owner}/{pullRequest.repository} <b>#{pullRequest.number}</b>
        </span>
        <span className="truncate font-semibold" title={pullRequest.title}>
          {pullRequest.title}
        </span>
      </TopBarTitle>
      <div className="flex flex-[1_1_260px] items-center gap-2.5">
        <Progress value={progress.percent} />
        <span data-slot="progress-summary" className="text-sm whitespace-nowrap text-muted">
          <b className="text-foreground">{Math.round(progress.percent)}%</b> of changed lines · {progress.viewedFiles}/
          {progress.totalFiles} files · <b className="text-foreground">{progress.needingReview}</b> need real review
          {progress.loadedFiles != null && (
            <>
              {' '}
              · loading {progress.loadedFiles}/{progress.totalFiles}
            </>
          )}
        </span>
      </div>
      {timeChip}
      <div className="flex items-center gap-2.5">
        {approval.status && <Approvals approvals={approval.status.approvals} />}
        <ApproveButton progress={progress} approval={approval} />
      </div>
      <div className="flex items-center gap-2.5">
        <Input
          ref={filterRef}
          className="w-[150px]"
          type="search"
          placeholder="Filter files  ( / )"
          value={filter}
          onChange={event => onFilterChange(event.target.value)}
        />
        <ToggleGroup options={DENSITY_OPTIONS} value={density} onValueChange={onDensityChange} />
        <label className="flex items-center gap-1 text-sm whitespace-nowrap text-muted max-[800px]:hidden">
          <Checkbox checked={hideViewed} onChange={event => onHideViewedChange(event.target.checked)} /> Hide viewed
        </label>
        <a
          className={classNames(buttonVariants({ variant: 'ghost', size: 'small' }))}
          href={githubUrl}
          onClick={event => {
            event.preventDefault();
            onClose();
          }}
        >
          GitHub view
        </a>
        <CloseButton onClose={onClose} />
      </div>
    </TopBarFrame>
  );
}
