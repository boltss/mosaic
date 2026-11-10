import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BucketId } from '../review/classify.ts';
import { buildTree, changedLines, directoryOf, weight } from '../review/model.ts';
import type { SameEditGroup } from '../review/sameEdit.ts';
import { isMarkdownPath } from '../markdown/markdownDiff.ts';
import { isTestPath, testOutline } from '../review/testOutline.ts';
import { pullRequestKey, type KeyValueStore } from '../metrics/metrics.ts';
import type { FileSummary, ReviewSource } from '../shared/types.ts';
import { CodeBlock, DiffLineView } from './Code.tsx';
import { Alert } from './components/Alert.tsx';
import { Button } from './components/Button.tsx';
import { Checkbox } from './components/Checkbox.tsx';
import { classNames } from './components/classNames.ts';
import { EmptyState, EmptyStateText } from './components/EmptyState.tsx';
import { Kbd } from './components/Kbd.tsx';
import { Toast, Toaster } from './components/Toast.tsx';
import { useApproval, useReviewData, useViewed, type Classified } from './data.ts';
import { MosaicSession } from './metricsStore.ts';
import { DiffPanel } from './Panel.tsx';
import {
  DEFAULT_SETTINGS,
  DENSITIES,
  DENSITY_ORDER,
  SETTINGS_KEY,
  settingsSchema,
  type Settings,
  type ViewMode,
} from './settings.ts';
import { Sidebar } from './Sidebar.tsx';
import { LARGE_THRESHOLD, Tile } from './Tile.tsx';
import { SummaryDialog, TimeChip } from './TimeSummary.tsx';
import { CloseButton, TopBar, TopBarFrame, TopBarTitle } from './TopBar.tsx';

/** Height of the sticky folder header; keep in step with --section-header-height in styles.css. */
const SECTION_HEADER_HEIGHT = 35;
const UNCLASSIFIED: Classified = { id: 'review', reason: '' };

interface ToastMessage {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  error?: boolean;
}

export interface ReviewProps {
  source: ReviewSource;
  store: KeyValueStore;
  onClose: () => void;
  /** After GitHub accepted the approval: leave Mosaic for the pull request's conversation. */
  onApproved: () => void;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function groupByDirectory(files: FileSummary[]): Map<string, FileSummary[]> {
  const byDirectory = new Map<string, FileSummary[]>();
  for (const file of files) {
    const directory = directoryOf(file.path);
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), file]);
  }
  return byDirectory;
}

export function Review({ source, store, onClose, onApproved }: ReviewProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    void store.get(SETTINGS_KEY).then(saved => setSettings(settingsSchema.parse(saved)));
  }, [store]);
  const saveSettings = (next: Settings) => {
    setSettings(next);
    void store.set(SETTINGS_KEY, next);
  };

  const data = useReviewData(source, settings.buckets);
  const { pullRequest, files, diffs, classified, diffState } = data;

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const dismissToast = (id: number) => setToasts(current => current.filter(toast => toast.id !== id));
  const showToast = useCallback((toast: Omit<ToastMessage, 'id'>, milliseconds = 10_000) => {
    const id = Math.random();
    setToasts(current => [...current.slice(-2), { ...toast, id }]);
    setTimeout(() => setToasts(current => current.filter(shown => shown.id !== id)), milliseconds);
  }, []);

  // ---- time measurement ----
  const sessionKey = pullRequest ? pullRequestKey(pullRequest.owner, pullRequest.repository, pullRequest.number) : null;
  const session = useMemo(() => (sessionKey ? new MosaicSession(store, sessionKey) : null), [store, sessionKey]);
  useEffect(() => {
    if (!session) return;
    void session.start();
    const poke = () => session.poke();
    const activityEvents = ['keydown', 'mousemove', 'mousedown', 'wheel'] as const;
    for (const eventName of activityEvents) window.addEventListener(eventName, poke, { passive: true, capture: true });
    return () => {
      for (const eventName of activityEvents) window.removeEventListener(eventName, poke, { capture: true });
      void session.stop();
    };
  }, [session]);
  const totalWeight = useMemo(() => files.reduce((sum, file) => sum + weight(file), 0), [files]);
  useEffect(() => {
    if (!session || !pullRequest) return;
    session.describe(new Map(files.map(file => [file.path, weight(file)])), {
      title: pullRequest.title,
      files: files.length,
      totalLines: totalWeight,
    });
  }, [session, pullRequest, files, totalWeight]);

  const { isViewed, setViewed, saving } = useViewed(source, pullRequest, files, {
    onFailed: (paths, value, retry) =>
      showToast(
        {
          text: `GitHub rejected ${value ? 'marking' : 'unmarking'} ${plural(paths.length, 'file')}`,
          error: true,
          action: { label: 'Retry', run: retry },
        },
        15_000,
      ),
    onApplied: (change, undo) => {
      session?.marked(change.paths, change.value, change.bulk);
      if (change.undoable)
        showToast({
          text: `${change.value ? 'Marked' : 'Unmarked'} ${change.paths.length} files ${change.value ? 'viewed' : ''}`,
          action: { label: 'Undo', run: undo },
        });
    },
  });

  const approval = useApproval(source, pullRequest, {
    onApproved,
    onFailed: (error, retry) =>
      showToast(
        {
          text: `GitHub rejected the approval (${error.message})`,
          error: true,
          action: { label: 'Retry', run: retry },
        },
        15_000,
      ),
  });

  // ---- UI state ----
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [bucketFilter, setBucketFilter] = useState<BucketId | null>(null);
  const [filter, setFilter] = useState('');
  const [hideViewed, setHideViewed] = useState(false);
  const [panelPath, setPanelPath] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [viewModes, setViewModes] = useState<Map<string, ViewMode>>(new Map());
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const filterRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const classificationOf = useCallback(
    (path: string): Classified => classified.byPath.get(path) ?? UNCLASSIFIED,
    [classified],
  );
  const bucketIdOf = useCallback((path: string) => classificationOf(path).id, [classificationOf]);
  // Test files whose diff reads as a list of test names. They are reviewed from that outline, so size doesn't lock them.
  const testPaths = useMemo(
    () =>
      new Set(
        files
          .filter(file => {
            const diff = isTestPath(file.path) ? diffs.get(file.path) : undefined;
            return !!diff?.complete && !diff.binary && testOutline(diff.lines) != null;
          })
          .map(file => file.path),
      ),
    [files, diffs],
  );
  // A file can't be marked viewed before its diff is shown, and large review files only after scrolling through them.
  const isLocked = useCallback(
    (file: FileSummary) =>
      diffState(file.path) !== 'ready' ||
      (changedLines(file) > LARGE_THRESHOLD &&
        bucketIdOf(file.path) === 'review' &&
        !testPaths.has(file.path) &&
        !unlocked.has(file.path)),
    [bucketIdOf, unlocked, diffState, testPaths],
  );
  const defaultViewMode = (path: string) => (isMarkdownPath(path) ? settings.markdownDefault : settings.testDefault);
  const viewModeOf = (path: string) => viewModes.get(path) ?? defaultViewMode(path);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return files.filter(
      file =>
        (!bucketFilter || bucketIdOf(file.path) === bucketFilter) &&
        (!needle || file.path.toLowerCase().includes(needle)) &&
        (!hideViewed || !isViewed(file.path)),
    );
  }, [files, bucketFilter, filter, hideViewed, isViewed, bucketIdOf]);

  const filterActive = !!bucketFilter || !!filter.trim() || hideViewed;
  const visiblePaths = useMemo(() => new Set(visible.map(file => file.path)), [visible]);
  /** Folder/tree/X actions only touch files the user can currently see. */
  const onlyVisible = (list: FileSummary[]) => (filterActive ? list.filter(file => visiblePaths.has(file.path)) : list);

  const sections = useMemo(() => [...groupByDirectory(visible)], [visible]);
  const filesByDirectory = useMemo(() => groupByDirectory(files), [files]);
  const tree = useMemo(() => buildTree(files.map(file => file.path)), [files]);

  const viewedFiles = files.filter(file => isViewed(file.path));
  const viewedWeight = viewedFiles.reduce((sum, file) => sum + weight(file), 0);
  const needingReview = files.filter(file => bucketIdOf(file.path) === 'review' && !isViewed(file.path)).length;

  // ---- actions ----
  const nextUnviewed = (from: string, viewedNow: (path: string) => boolean) => {
    const start = visible.findIndex(file => file.path === from);
    for (let step = 1; step <= visible.length; step++) {
      const candidate = visible[(start + step) % visible.length]!;
      if (!viewedNow(candidate.path)) return candidate.path;
    }
    return from;
  };
  const findInMain = (selector: string) => mainRef.current?.querySelector(selector);
  const sectionSelector = (directory: string) => `[data-slot="section"][data-directory="${CSS.escape(directory)}"]`;
  // Marking something viewed collapses it. If its top was already scrolled out of sight (ticked from a
  // sticky header), bring that top back so the reader sees it close and what comes next, instead of
  // landing wherever the content below happens to slide to.
  const pinTop = (find: () => Element | null | undefined, offset = 0) => {
    const main = mainRef.current;
    const element = find();
    if (!main || !element) return;
    const topOf = (target: Element) =>
      target.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - offset;
    const topBefore = topOf(element);
    if (topBefore >= main.scrollTop) return;
    const settle = () => {
      const current = find();
      main.scrollTop = current?.isConnected ? topOf(current) : topBefore;
    };
    requestAnimationFrame(() => {
      settle();
      requestAnimationFrame(settle);
    });
  };
  const toggleMany = (list: FileSummary[]) => {
    if (!list.length) return;
    const allViewed = list.every(file => isViewed(file.path));
    const targets = allViewed ? list : list.filter(file => !isLocked(file));
    const skipped = list.length - targets.length;
    setViewed(
      targets.map(file => file.path),
      !allViewed,
      { bulk: true, undoable: true },
    );
    if (skipped)
      showToast(
        {
          text: `${plural(skipped, 'file')} skipped: still loading, or large files that must be opened and read first`,
        },
        6000,
      );
  };
  const toggleSection = (directory: string, list: FileSummary[]) => {
    if (list.some(file => !isViewed(file.path))) pinTop(() => findInMain(sectionSelector(directory)));
    toggleMany(list);
  };
  const toggleOne = (path: string) => {
    const file = files.find(candidate => candidate.path === path);
    if (!file) return;
    const wasViewed = isViewed(path);
    if (!wasViewed && isLocked(file)) {
      setPanelPath(path);
      return;
    }
    if (!wasViewed)
      pinTop(() => findInMain(`[data-slot="tile"][data-path="${CSS.escape(path)}"]`), SECTION_HEADER_HEIGHT + 8);
    setViewed([path], !wasViewed, { bulk: false, undoable: false });
    if (!wasViewed) {
      const next = nextUnviewed(path, candidate => candidate === path || isViewed(candidate));
      setFocusedPath(next);
      if (panelPath) setPanelPath(next);
    }
  };
  const moveFocus = (direction: 1 | -1) => {
    if (!visible.length) return;
    const current = visible.findIndex(file => file.path === focusedPath);
    const next = (
      current < 0
        ? visible[direction === 1 ? 0 : visible.length - 1]!
        : visible[(current + direction + visible.length) % visible.length]!
    ).path;
    setFocusedPath(next);
    if (panelPath) setPanelPath(next);
  };
  const jumpToDirectory = (directory: string) => {
    const exact = `[data-slot="section"][data-directory="${CSS.escape(directory)}"]`;
    const nested = `[data-slot="section"][data-directory^="${CSS.escape(directory)}/"]`;
    findInMain(directory ? `${exact}, ${nested}` : exact)?.scrollIntoView({ block: 'start' });
  };
  const toggleViewMode = (path: string) =>
    setViewModes(current =>
      new Map(current).set(path, (current.get(path) ?? defaultViewMode(path)) === 'preview' ? 'code' : 'preview'),
    );

  // Stable handlers so memoised tiles don't re-render on every keypress.
  const tileActions = useRef({ toggleOne, retry: data.retry });
  useLayoutEffect(() => {
    tileActions.current = { toggleOne, retry: data.retry };
  });
  const onTileToggle = useCallback((path: string) => tileActions.current.toggleOne(path), []);
  const onTileOpen = useCallback((path: string) => setPanelPath(path), []);
  const onTileFocus = useCallback((path: string) => setFocusedPath(path), []);
  const onTileRetry = useCallback(() => tileActions.current.retry(), []);
  const onTileViewMode = useCallback(
    (path: string, mode: ViewMode) => setViewModes(current => new Map(current).set(path, mode)),
    [],
  );
  const onReachedEnd = useCallback(
    (path: string) => setUnlocked(current => (current.has(path) ? current : new Set(current).add(path))),
    [],
  );
  const onPanelClose = useCallback(() => setPanelPath(null), []);
  const pickBucket = (bucket: BucketId | null) => {
    setBucketFilter(bucket);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  };

  // ---- keyboard (capture phase so GitHub's own shortcuts never fire while Mosaic is open) ----
  const keyboardState = {
    moveFocus,
    toggleOne,
    toggleSection,
    toggleViewMode,
    focusedPath,
    panelPath,
    summaryOpen,
    filesByDirectory,
    visiblePaths,
    onlyVisible,
    testPaths,
    settings,
    saveSettings,
  };
  const latestKeyboardState = useRef(keyboardState);
  useLayoutEffect(() => {
    latestKeyboardState.current = keyboardState;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const eventPath = event.composedPath();
      const inTextInput = eventPath.some(
        node => node instanceof HTMLInputElement && (node.type === 'search' || node.type === 'text'),
      );
      const state = latestKeyboardState.current;
      if (inTextInput) {
        if (event.key === 'Escape') (eventPath[0] as HTMLElement).blur();
        event.stopImmediatePropagation();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const { key } = event;
      // Enter/space on a focused button or link should click it, not open a diff.
      if (
        (key === 'Enter' || key === ' ') &&
        eventPath.some(node => node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement)
      ) {
        event.stopImmediatePropagation();
        return;
      }
      const focused = state.focusedPath && state.visiblePaths.has(state.focusedPath) ? state.focusedPath : null;
      const handled = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      if (key === 'Escape') {
        handled();
        if (state.summaryOpen) setSummaryOpen(false);
        else if (state.panelPath) setPanelPath(null);
        else onClose();
        return;
      }
      if (key === 'j') {
        handled();
        state.moveFocus(1);
      } else if (key === 'k') {
        handled();
        state.moveFocus(-1);
      } else if (key === 'x' && focused) {
        handled();
        state.toggleOne(focused);
      } else if (key === 'X' && focused) {
        handled();
        const directory = directoryOf(focused);
        state.toggleSection(directory, state.onlyVisible(state.filesByDirectory.get(directory) ?? []));
      } else if (key === 'Enter' && focused) {
        handled();
        setPanelPath(focused);
      } else if (
        key === 'p' &&
        state.focusedPath &&
        (isMarkdownPath(state.focusedPath) || state.testPaths.has(state.focusedPath))
      ) {
        handled();
        state.toggleViewMode(state.focusedPath);
      } else if (key === 't') {
        handled();
        setSummaryOpen(open => !open);
      } else if (key === 'v') {
        handled();
        setHideViewed(hidden => !hidden);
      } else if (key === '/') {
        handled();
        filterRef.current?.focus();
      } else if (key === '1' || key === '2' || key === '3') {
        handled();
        state.saveSettings({ ...state.settings, density: DENSITY_ORDER[Number(key) - 1]! });
      } else if (key.length === 1 || key.startsWith('Arrow') || key === ' ') event.stopImmediatePropagation(); // keep GitHub's hotkeys quiet
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // Keep focus on something visible: filters, buckets and "hide viewed" can remove the focused file.
  // Adjusted while rendering (not in an effect) so there is never a frame with a hidden file focused.
  if (!(focusedPath && visiblePaths.has(focusedPath))) {
    const next = visible.find(file => !isViewed(file.path))?.path ?? visible[0]?.path ?? null;
    if (next !== focusedPath) setFocusedPath(next);
  }
  useEffect(() => {
    if (summaryOpen) void session?.refreshBaseline();
  }, [summaryOpen, session]);

  // ---- render ----
  if (data.overview.isPending)
    return (
      <Shell onClose={onClose}>
        <EmptyState title="Loading pull request…">
          <EmptyStateText>Reading the file list from GitHub.</EmptyStateText>
        </EmptyState>
      </Shell>
    );
  if (data.overview.isError || !pullRequest) {
    const error = data.overview.error;
    // Errors cross bundle boundaries (content script → UI module), so match by name, not instanceof.
    if (error?.name === 'NotLoggedInError')
      return (
        <Shell onClose={onClose}>
          <EmptyState title="Log in to GitHub to use Mosaic">
            <EmptyStateText>
              Mosaic reads pull requests through your GitHub session — no tokens.{' '}
              <a className="text-primary underline" href="/login" target="_top">
                Log in
              </a>{' '}
              ·{' '}
              <Button variant="link" onClick={onClose}>
                Close
              </Button>
            </EmptyStateText>
          </EmptyState>
        </Shell>
      );
    return (
      <Shell onClose={onClose}>
        <EmptyState
          title={
            error?.name === 'GitHubShapeError'
              ? 'GitHub changed something Mosaic relies on'
              : 'Could not load this pull request'
          }
        >
          <EmptyStateText className="font-mono text-sm">{String(error?.message)}</EmptyStateText>
          <EmptyStateText>
            Make sure you are logged in to GitHub.{' '}
            <Button variant="link" onClick={() => void data.overview.refetch()}>
              Try again
            </Button>{' '}
            ·{' '}
            <Button variant="link" onClick={onClose}>
              Back to GitHub's view
            </Button>
          </EmptyStateText>
        </EmptyState>
      </Shell>
    );
  }

  const density = DENSITIES[settings.density];
  const panelFile = panelPath ? files.find(file => file.path === panelPath) : undefined;

  return (
    <div
      className="contents"
      style={{ ['--tile-width' as string]: `${density.tileWidth}px`, ['--code-size' as string]: density.codeSize }}
    >
      <TopBar
        pullRequest={pullRequest}
        progress={{
          percent: totalWeight ? (100 * viewedWeight) / totalWeight : 0,
          viewedFiles: viewedFiles.length,
          totalFiles: files.length,
          needingReview,
          loadedFiles: data.allLoaded ? null : data.loadedCount,
        }}
        approval={{ ...approval, onApprove: approval.approve }}
        timeChip={session && <TimeChip session={session} onClick={() => setSummaryOpen(open => !open)} />}
        filter={filter}
        onFilterChange={setFilter}
        filterRef={filterRef}
        density={settings.density}
        onDensityChange={next => saveSettings({ ...settings, density: next })}
        hideViewed={hideViewed}
        onHideViewedChange={setHideViewed}
        githubUrl={source.githubUrl(pullRequest)}
        onClose={onClose}
      />

      <div className="grid min-h-0 grid-cols-[270px_1fr] max-[800px]:grid-cols-[200px_1fr]">
        <Sidebar
          files={files}
          tree={tree}
          bucketIdOf={bucketIdOf}
          isViewed={isViewed}
          bucketFilter={bucketFilter}
          onPickBucket={pickBucket}
          onToggleFiles={toggleMany}
          onTogglePaths={paths => {
            const wanted = new Set(paths);
            toggleMany(onlyVisible(files.filter(file => wanted.has(file.path))));
          }}
          onJumpToDirectory={jumpToDirectory}
          settings={settings}
          onSettingsChange={saveSettings}
        />

        {/* The scrollbar is always there: with an automatic one, every change in content height (a file
            collapsing, a tile growing) made the browser lay the whole review out again, twice. */}
        <main data-slot="main" className="relative overflow-x-hidden overflow-y-scroll px-3.5 pb-10" ref={mainRef}>
          {bucketFilter === 'sameEdit' &&
            classified.groups.map(group => {
              const related = files.filter(file => classificationOf(file.path).groupId === group.id);
              const groupFiles = related.filter(file => bucketIdOf(file.path) === 'sameEdit');
              return (
                <SameEditBanner
                  key={group.id}
                  group={group}
                  remaining={groupFiles.filter(file => !isViewed(file.path)).length}
                  partialMatches={related.filter(file => classificationOf(file.path).extraLines != null).length}
                  onToggle={() => toggleMany(groupFiles)}
                />
              );
            })}
          {data.rawDiffError && (
            <Alert variant="warning">
              Couldn't load the full diff ({data.rawDiffError.message}). Files GitHub truncated can't be shown.{' '}
              <Button className="ml-1.5" onClick={data.retry}>
                Retry
              </Button>
            </Alert>
          )}
          {sections.map(([directory, shownFiles]) => {
            const folderFiles = filesByDirectory.get(directory)!;
            const scope = onlyVisible(folderFiles);
            const scopeViewed = scope.filter(file => isViewed(file.path)).length;
            const folderViewed = folderFiles.filter(file => isViewed(file.path)).length;
            const nameStart = directory.lastIndexOf('/') + 1;
            return (
              <section key={directory} data-slot="section" data-directory={directory} className="mt-3.5">
                <div
                  data-slot="section-header"
                  className="sticky top-0 z-2 flex h-(--section-header-height) items-center gap-2.5 border-b border-subtle bg-background/92 px-1 backdrop-blur-[4px]"
                >
                  <Checkbox
                    checked={scopeViewed === scope.length}
                    indeterminate={scopeViewed > 0 && scopeViewed < scope.length}
                    title={
                      filterActive
                        ? `Mark the ${scope.length} shown files in this folder viewed (⇧X)`
                        : 'Mark folder viewed (⇧X)'
                    }
                    onChange={() => toggleSection(directory, scope)}
                  />
                  <span
                    className={classNames(
                      'truncate text-[12.5px] font-semibold',
                      folderViewed === folderFiles.length && 'text-faint',
                    )}
                  >
                    {directory ? (
                      <>
                        <span className="font-normal text-muted">{directory.slice(0, nameStart)}</span>
                        {directory.slice(nameStart)}
                      </>
                    ) : (
                      '(root)'
                    )}
                  </span>
                  <span className="ml-auto text-sm whitespace-nowrap text-muted">
                    {folderViewed}/{folderFiles.length} viewed ·{' '}
                    <span className="text-success">+{folderFiles.reduce((sum, file) => sum + file.additions, 0)}</span>{' '}
                    <span className="text-danger">−{folderFiles.reduce((sum, file) => sum + file.deletions, 0)}</span>
                  </span>
                </div>
                <div className="grid auto-rows-[2px] grid-cols-[repeat(auto-fill,minmax(min(var(--tile-width),100%),1fr))] gap-x-2 pt-2">
                  {shownFiles.map(file => (
                    <Tile
                      key={file.path}
                      file={file}
                      diff={diffs.get(file.path)}
                      diffState={diffState(file.path)}
                      classification={classificationOf(file.path)}
                      viewed={isViewed(file.path)}
                      focused={focusedPath === file.path}
                      locked={isLocked(file)}
                      isMarkdown={isMarkdownPath(file.path)}
                      isTest={testPaths.has(file.path)}
                      viewMode={viewModeOf(file.path)}
                      source={source}
                      pullRequest={pullRequest}
                      onToggleViewed={onTileToggle}
                      onOpen={onTileOpen}
                      onFocus={onTileFocus}
                      onRetry={onTileRetry}
                      onViewModeChange={onTileViewMode}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {!visible.length && (
            <p className="mt-10 text-center text-muted">
              {files.length ? 'Nothing left here 🎉' : 'This pull request has no file changes.'}
            </p>
          )}
        </main>
      </div>

      <Footer>
        <Shortcut keys={['j', 'k']} separator="/" label="next/prev" />
        <Shortcut keys={['x']} label="viewed → next" />
        <Shortcut keys={['⇧X']} label="whole folder" />
        <Shortcut keys={['↵']} label="open diff" />
        <Shortcut keys={['p']} label="preview/code" />
        <Shortcut keys={['/']} label="filter" />
        <Shortcut keys={['1', '2', '3']} label="size" />
        <Shortcut keys={['v']} label="hide viewed" />
        <Shortcut keys={['t']} label="time" />
        <Shortcut keys={['esc']} label="close" />
        <span className="ml-auto text-faint">{saving ? 'Saving to GitHub…' : 'Viewed state syncs with GitHub'}</span>
      </Footer>

      {panelFile && (
        <DiffPanel
          key={panelFile.path}
          file={panelFile}
          diff={diffs.get(panelFile.path)}
          viewed={isViewed(panelFile.path)}
          locked={isLocked(panelFile)}
          githubUrl={source.githubUrl(pullRequest, panelFile.path)}
          source={source}
          pullRequest={pullRequest}
          onToggleViewed={onTileToggle}
          onClose={onPanelClose}
          onReachedEnd={onReachedEnd}
        />
      )}
      {summaryOpen && session && (
        <SummaryDialog
          session={session}
          totalLines={totalWeight}
          title={`#${pullRequest.number} ${pullRequest.title}`}
          done={viewedFiles.length === files.length}
          onClose={() => setSummaryOpen(false)}
        />
      )}
      <Toaster>
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            variant={toast.error ? 'error' : 'default'}
            action={
              toast.action && {
                label: toast.action.label,
                onClick: () => {
                  toast.action!.run();
                  dismissToast(toast.id);
                },
              }
            }
          >
            {toast.text}
          </Toast>
        ))}
      </Toaster>
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="flex flex-wrap gap-x-3.5 gap-y-1 border-t border-border bg-surface px-3.5 py-[5px] text-[11.5px] text-muted">
      {children}
    </footer>
  );
}

/** One keyboard shortcut in the footer: its keys, then what they do. */
function Shortcut({ keys, separator = '', label }: { keys: string[]; separator?: string; label: string }) {
  return (
    <span>
      {keys.map((key, index) => (
        <span key={key}>
          {index > 0 && separator}
          <Kbd>{key}</Kbd>
        </span>
      ))}
      {` ${label}`}
    </span>
  );
}

/** The frame shown while there is no review yet: loading, logged out, or failed. */
function Shell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);
  return (
    <div className="contents">
      <TopBarFrame>
        <TopBarTitle />
        <CloseButton onClose={onClose} />
      </TopBarFrame>
      <div className="min-h-0">{children}</div>
      <Footer>
        <span>esc close</span>
      </Footer>
    </div>
  );
}

function SameEditBanner({
  group,
  remaining,
  partialMatches,
  onToggle,
}: {
  group: SameEditGroup;
  /** Files of the group not marked viewed yet. */
  remaining: number;
  /** Files that contain this edit plus other changes. */
  partialMatches: number;
  onToggle: () => void;
}) {
  return (
    <div
      data-slot="same-edit-banner"
      className="mt-3.5 rounded-xl border border-highlight/45 bg-highlight/7 px-3.5 py-3"
    >
      <h4 className="mb-1.5 font-bold">One edit, {group.paths.length} files</h4>
      <p className="mb-2 text-sm text-muted">
        <b className="text-foreground">{group.paths.length} files are exactly this edit</b> after normalising imported
        names and relative paths, with <b className="text-foreground">0 other changed lines</b>. Review it once, approve
        all.
      </p>
      <CodeBlock className="rounded-lg border border-border bg-background">
        {group.lines.map((line, index) => (
          <DiffLineView key={index} line={{ kind: line[0] === '+' ? 'addition' : 'deletion', text: line.slice(1) }} />
        ))}
      </CodeBlock>
      {partialMatches > 0 && (
        <div className="mt-2 text-sm text-info">
          ⓘ {partialMatches} more file{partialMatches > 1 ? 's' : ''} contain this edit plus other changes — they stay
          in Needs review, marked “same edit +N”.
        </div>
      )}
      <Button variant="approve" className="mt-2.5" onClick={onToggle}>
        {remaining ? `✓ Approve all ${remaining} remaining` : 'Undo approve all'}
      </Button>
    </div>
  );
}
