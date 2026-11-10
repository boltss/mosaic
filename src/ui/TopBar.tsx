import type { ReactNode, Ref } from 'react';
import { LOGO_TILES, type PullRequest } from '../shared/types.ts';
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

export function TopBar({
  pullRequest,
  progress,
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
