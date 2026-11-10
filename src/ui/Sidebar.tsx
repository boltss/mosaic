import type { ReactNode } from 'react';
import { BUCKETS, type BucketId } from '../review/classify.ts';
import { changedLines, type TreeNode } from '../review/model.ts';
import type { FileSummary } from '../shared/types.ts';
import { Button } from './components/Button.tsx';
import { Checkbox } from './components/Checkbox.tsx';
import { classNames } from './components/classNames.ts';
import { Progress } from './components/Progress.tsx';
import type { Settings } from './settings.ts';

function SidebarHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1 text-xs tracking-[0.06em] text-muted uppercase">
      {children}
    </div>
  );
}

function BucketRow({
  label,
  color,
  count,
  done = false,
  selected,
  title,
  onSelect,
  action,
}: {
  label: string;
  color: string;
  count: ReactNode;
  done?: boolean;
  selected: boolean;
  title?: string;
  onSelect: () => void;
  action?: ReactNode;
}) {
  return (
    <div
      data-slot="bucket"
      data-selected={selected || undefined}
      className={classNames(
        'flex cursor-pointer items-center gap-2 py-[3px] pr-2.5 pl-3.5',
        selected ? 'bg-selected shadow-[inset_2px_0_var(--primary)]' : 'hover:bg-hover',
      )}
      title={title}
      onClick={onSelect}
    >
      <span className="size-2 flex-none rounded-full" style={{ background: color }} />
      <span className="flex-1 truncate">{label}</span>
      <span className={classNames('text-sm tabular-nums', done ? 'text-success' : 'text-muted')}>{count}</span>
      {action}
    </div>
  );
}

function FolderTree({
  node,
  depth,
  isViewed,
  onToggle,
  onJump,
}: {
  node: TreeNode;
  depth: number;
  isViewed: (path: string) => boolean;
  onToggle: (paths: string[]) => void;
  onJump: (directory: string) => void;
}) {
  const viewedCount = node.files.filter(isViewed).length;
  const allViewed = viewedCount === node.files.length;
  return (
    <>
      <div
        data-slot="folder"
        className="flex cursor-pointer items-center gap-1.5 py-0.5 pr-2.5 text-sm whitespace-nowrap hover:bg-hover"
        style={{ paddingLeft: 10 + depth * 12 }}
        onClick={() => onJump(node.path)}
        title={node.path}
      >
        <Checkbox
          checked={allViewed}
          indeterminate={viewedCount > 0 && !allViewed}
          onClick={event => event.stopPropagation()}
          onChange={() => onToggle(node.files)}
        />
        <span className={classNames('flex-1 truncate', allViewed && 'text-faint line-through')}>{node.name}</span>
        <Progress size="small" value={(100 * viewedCount) / node.files.length} />
        <span className="w-7 flex-none text-right text-xs text-faint">{node.files.length}</span>
      </div>
      {node.children.map(child => (
        <FolderTree
          key={child.path}
          node={child}
          depth={depth + 1}
          isViewed={isViewed}
          onToggle={onToggle}
          onJump={onJump}
        />
      ))}
    </>
  );
}

function SettingsToggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <Checkbox checked={checked} onChange={event => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

export function Sidebar({
  files,
  tree,
  bucketIdOf,
  isViewed,
  bucketFilter,
  onPickBucket,
  onToggleFiles,
  onTogglePaths,
  onJumpToDirectory,
  settings,
  onSettingsChange,
}: {
  files: FileSummary[];
  tree: TreeNode;
  bucketIdOf: (path: string) => BucketId;
  isViewed: (path: string) => boolean;
  bucketFilter: BucketId | null;
  onPickBucket: (bucket: BucketId | null) => void;
  /** Mark these files viewed, or unmark them when they all are. */
  onToggleFiles: (files: FileSummary[]) => void;
  /** The same, for a folder: only the files currently shown are touched. */
  onTogglePaths: (paths: string[]) => void;
  /** Scroll the review to a folder; '' is the repository root. */
  onJumpToDirectory: (directory: string) => void;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}) {
  return (
    <nav
      data-slot="sidebar"
      className="overflow-x-hidden overflow-y-auto border-r border-border pt-2 pb-5 [scrollbar-gutter:stable]"
    >
      <BucketRow
        label="All files"
        color="var(--foreground)"
        count={files.length}
        selected={!bucketFilter}
        onSelect={() => onPickBucket(null)}
      />
      <SidebarHeading>Triage</SidebarHeading>
      {BUCKETS.map(bucket => {
        const bucketFiles = files.filter(file => bucketIdOf(file.path) === bucket.id);
        if (!bucketFiles.length) return null;
        const unviewed = bucketFiles.filter(file => !isViewed(file.path));
        const unviewedLines = unviewed.reduce((sum, file) => sum + changedLines(file), 0);
        return (
          <div key={bucket.id}>
            {bucket.id === 'renamed' && <SidebarHeading>Low-risk · approve in bulk</SidebarHeading>}
            <BucketRow
              label={bucket.label}
              color={bucket.color}
              count={unviewed.length ? `${unviewed.length}/${bucketFiles.length}` : `✓ ${bucketFiles.length}`}
              done={!unviewed.length}
              selected={bucketFilter === bucket.id}
              title={bucket.lowRisk ? 'Click to skim this bucket before approving' : ''}
              onSelect={() => onPickBucket(bucket.id)}
              action={
                bucket.lowRisk && (
                  <Button
                    data-slot="bucket-toggle-all"
                    className="text-muted hover:border-success hover:text-success"
                    title={
                      unviewed.length
                        ? `Mark ${unviewed.length} files · ${unviewedLines} changed lines viewed`
                        : `Unmark all ${bucketFiles.length} files`
                    }
                    onClick={event => {
                      event.stopPropagation();
                      onToggleFiles(bucketFiles);
                    }}
                  >
                    {unviewed.length ? '✓ all' : 'undo'}
                  </Button>
                )
              }
            />
          </div>
        );
      })}
      <SidebarHeading>Folders</SidebarHeading>
      {tree.children.map(node => (
        <FolderTree
          key={node.path}
          node={node}
          depth={0}
          isViewed={isViewed}
          onToggle={onTogglePaths}
          onJump={onJumpToDirectory}
        />
      ))}
      {tree.files.some(path => !path.includes('/')) && (
        <div
          data-slot="folder"
          className="flex cursor-pointer items-center gap-1.5 py-0.5 pr-2.5 pl-2.5 text-sm whitespace-nowrap hover:bg-hover"
          onClick={() => onJumpToDirectory('')}
        >
          <span className="flex-1 truncate">(root files)</span>
        </div>
      )}
      <SidebarHeading>Settings</SidebarHeading>
      <div className="grid gap-0.5 px-3.5 py-1 text-sm text-muted">
        {BUCKETS.filter(bucket => bucket.lowRisk).map(bucket => (
          <SettingsToggle
            key={bucket.id}
            checked={settings.buckets[bucket.id] !== false}
            onChange={checked =>
              onSettingsChange({ ...settings, buckets: { ...settings.buckets, [bucket.id]: checked } })
            }
          >
            {bucket.label}
          </SettingsToggle>
        ))}
        <SettingsToggle
          checked={settings.markdownDefault === 'preview'}
          onChange={checked => onSettingsChange({ ...settings, markdownDefault: checked ? 'preview' : 'code' })}
        >
          Markdown preview by default
        </SettingsToggle>
        <SettingsToggle
          checked={settings.testDefault === 'preview'}
          onChange={checked => onSettingsChange({ ...settings, testDefault: checked ? 'preview' : 'code' })}
        >
          Test files as a list of test names
        </SettingsToggle>
      </div>
    </nav>
  );
}
