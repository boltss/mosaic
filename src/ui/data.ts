// Data hooks: pull request + diffs via TanStack Query, viewed state with optimistic updates.
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { classify, type Bucket, type BucketSettings } from '../review/classify.ts';
import { sortFiles } from '../review/model.ts';
import { findSameEdits, type SameEditGroup } from '../review/sameEdit.ts';
import type { FileDiff, FileSide, FileSummary, PullRequest, ReviewSource } from '../shared/types.ts';

/** Run tasks with at most `limit` in flight; resolves with per-task results. */
export async function pool<Item, Result>(
  items: Item[],
  limit: number,
  run: (item: Item) => Promise<Result>,
): Promise<PromiseSettledResult<Result>[]> {
  const results: PromiseSettledResult<Result>[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: 'fulfilled', value: await run(items[index]!) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Limits concurrent requests across queries. */
function semaphore(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <Result>(run: () => Promise<Result>): Promise<Result> => {
    if (active >= limit) await new Promise<void>(resolve => waiting.push(resolve));
    active++;
    try {
      return await run();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const diffSlots = semaphore(4);

export type DiffState = 'loading' | 'ready' | 'error';

const countChanges = (diff: FileDiff) => {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.lines) {
    if (line.kind === 'addition') additions++;
    else if (line.kind === 'deletion') deletions++;
  }
  return { additions, deletions };
};
const matchesSummary = (file: FileSummary, diff: FileDiff) => {
  if (diff.binary) return true;
  const counted = countChanges(diff);
  return counted.additions === file.additions && counted.deletions === file.deletions;
};

export type MergeCache = WeakMap<FileDiff, Map<FileDiff | undefined, FileDiff>>;

/**
 * Choose what to show for one file. GitHub's highlighted entry wins when it is complete and its
 * line counts match the summary; otherwise the raw .diff. If neither matches, show the most
 * complete one with a visible warning — never silently fewer lines.
 */
export function pickDiff(
  file: FileSummary,
  entryDiff: FileDiff | undefined,
  rawDiff: FileDiff | undefined,
  rawLoaded: boolean,
  cache?: MergeCache,
): FileDiff | undefined {
  const cached = (key: FileDiff, other: FileDiff | undefined, create: () => FileDiff) => {
    if (!cache) return create();
    let byOther = cache.get(key);
    if (!byOther) cache.set(key, (byOther = new Map()));
    let merged = byOther.get(other);
    if (!merged) byOther.set(other, (merged = create()));
    return merged;
  };
  if (entryDiff?.complete && matchesSummary(file, entryDiff)) return entryDiff;
  if (rawDiff && matchesSummary(file, rawDiff))
    return cached(rawDiff, entryDiff, () => ({ ...rawDiff, isGenerated: entryDiff?.isGenerated }));
  if (!rawLoaded) return entryDiff && { ...entryDiff, complete: false }; // wait for the raw diff before deciding
  const best = rawDiff ?? (entryDiff?.complete ? entryDiff : undefined);
  if (!best) return entryDiff && { ...entryDiff, complete: false };
  const shown = countChanges(best);
  return cached(best, entryDiff === best ? undefined : entryDiff, () => ({
    ...best,
    isGenerated: entryDiff?.isGenerated,
    warning: `Shown +${shown.additions} −${shown.deletions}, but GitHub reports +${file.additions} −${file.deletions} for this file. Check it on GitHub.`,
  }));
}

/** A file's bucket, plus its "same edit" group when it belongs to (or partly contains) one. */
export interface Classified extends Bucket {
  groupId?: string;
  /** Changed lines beyond the group's shared edit; set only for files that stay in Needs review. */
  extraLines?: number;
}

interface BatchQueryResult {
  data?: FileDiff[];
  isError: boolean;
  isSuccess: boolean;
  refetch: () => unknown;
}

function combineBatches(results: BatchQueryResult[]) {
  const entries = new Map<string, FileDiff>();
  const failedBatches = new Set<number>();
  const settledBatches = new Set<number>();
  results.forEach((result, batchIndex) => {
    for (const diff of result.data ?? []) entries.set(diff.path, diff);
    if (result.isError) failedBatches.add(batchIndex);
    if (result.isError || result.isSuccess) settledBatches.add(batchIndex);
  });
  return {
    entries,
    failedBatches,
    settledBatches,
    refetchFailed: () => {
      for (const result of results) if (result.isError) result.refetch();
    },
  };
}

export function useReviewData(source: ReviewSource, settings: BucketSettings) {
  const overview = useQuery({
    queryKey: ['pullRequest'],
    queryFn: () => source.loadPullRequest(),
    staleTime: Infinity,
    retry: 1,
  });
  const pullRequest = overview.data?.pullRequest;
  const ordered = useMemo(() => sortFiles(overview.data?.files ?? []), [overview.data]);
  const batches = useMemo(
    () => (pullRequest ? source.planDiffBatches(ordered.map(file => file.path)) : []),
    [pullRequest, ordered, source],
  );

  const { entries, failedBatches, settledBatches, refetchFailed } = useQueries({
    queries: batches.map(batch => ({
      queryKey: ['diff', batch[0], batch.length],
      queryFn: () => diffSlots(() => source.loadDiffBatch(pullRequest!, batch)),
      staleTime: Infinity,
      retry: 2,
    })),
    combine: combineBatches,
  });
  const rawDiff = useQuery({
    queryKey: ['rawDiff'],
    queryFn: () => source.loadRawDiff(pullRequest!),
    enabled: !!pullRequest,
    staleTime: Infinity,
    retry: 1,
  });

  /** Files from the summary plus anything only the raw diff knows about (completeness). */
  const files = useMemo<FileSummary[]>(() => {
    if (!rawDiff.data) return ordered;
    const known = new Set(ordered.map(file => file.path));
    const extra: FileSummary[] = [];
    for (const [path, diff] of rawDiff.data) {
      if (known.has(path)) continue;
      const { additions, deletions } = countChanges(diff);
      extra.push({
        path,
        status: deletions && !additions ? 'deleted' : 'modified',
        additions,
        deletions,
        viewed: false,
      });
    }
    return extra.length ? sortFiles([...ordered, ...extra]) : ordered;
  }, [ordered, rawDiff.data]);

  // Merged diffs are cached by their inputs so unchanged files keep the same object (memoised tiles stay put).
  // The two caches below are read while rendering on purpose: they only ever return an object equal to the one
  // just computed, so the result is the same with or without them.
  /* oxlint-disable react/refs */
  const mergeCache = useRef<MergeCache>(new WeakMap());
  const diffs = useMemo(() => {
    const merged = new Map<string, FileDiff>();
    for (const file of files) {
      const diff = pickDiff(
        file,
        entries.get(file.path),
        rawDiff.data?.get(file.path),
        !!rawDiff.data,
        mergeCache.current,
      );
      if (diff) merged.set(file.path, diff);
    }
    return merged;
  }, [files, entries, rawDiff.data]);

  const batchIndexByPath = useMemo(() => {
    const indexes = new Map<string, number>();
    batches.forEach((batch, batchIndex) => {
      for (const path of batch) indexes.set(path, batchIndex);
    });
    return indexes;
  }, [batches]);

  const diffState = useCallback(
    (path: string): DiffState => {
      if (diffs.get(path)?.complete) return 'ready';
      const batchIndex = batchIndexByPath.get(path);
      const batchSettled = batchIndex == null || settledBatches.has(batchIndex);
      const rawSettled = rawDiff.isSuccess || rawDiff.isError;
      // Both sources have answered and neither produced a complete diff: say so instead of spinning forever.
      if (batchSettled && rawSettled) return 'error';
      if (batchIndex != null && failedBatches.has(batchIndex) && rawDiff.isError) return 'error';
      return 'loading';
    },
    [diffs, batchIndexByPath, rawDiff.isSuccess, rawDiff.isError, failedBatches, settledBatches],
  );

  // Every file has settled: shown, or visibly failed (so grouping and the loading counter don't wait forever).
  const allLoaded = files.length > 0 && files.every(file => diffState(file.path) !== 'loading');

  // Reuse previous classification objects when nothing changed, so memoised tiles don't re-render.
  const previousClassification = useRef(new Map<string, Classified>());
  const classified = useMemo(() => {
    const byPath = new Map<string, Classified>();
    for (const file of files) byPath.set(file.path, classify(file, diffs.get(file.path), settings));
    let groups: SameEditGroup[] = [];
    if (settings.sameEdit !== false && allLoaded) {
      const candidates = files.filter(file => byPath.get(file.path)!.id === 'review').map(file => file.path);
      const sameEdits = findSameEdits(candidates, diffs);
      groups = sameEdits.groups;
      for (const group of sameEdits.groups)
        for (const path of group.paths)
          byPath.set(path, {
            id: 'sameEdit',
            reason: `identical to ${group.paths.length - 1} other files after normalising names`,
            groupId: group.id,
          });
      for (const [path, match] of sameEdits.partialMatches)
        byPath.set(path, { ...byPath.get(path)!, extraLines: match.extraLines, groupId: match.groupId });
    }
    for (const [path, current] of byPath) {
      const previous = previousClassification.current.get(path);
      if (
        previous &&
        previous.id === current.id &&
        previous.reason === current.reason &&
        previous.groupId === current.groupId &&
        previous.extraLines === current.extraLines
      )
        byPath.set(path, previous);
    }
    previousClassification.current = byPath;
    return { byPath, groups };
  }, [files, diffs, settings, allLoaded]);
  /* oxlint-enable react/refs */

  const retry = useCallback(() => {
    refetchFailed();
    if (rawDiff.isError) void rawDiff.refetch();
  }, [refetchFailed, rawDiff]);

  return {
    overview,
    pullRequest,
    files,
    diffs,
    diffState,
    classified,
    allLoaded,
    rawDiffError: rawDiff.error,
    retry,
    loadedCount: files.filter(file => diffState(file.path) !== 'loading').length,
  };
}

export interface ViewedChange {
  paths: string[];
  value: boolean;
  bulk: boolean;
  undoable: boolean;
}

export function useViewed(
  source: ReviewSource,
  pullRequest: PullRequest | undefined,
  files: FileSummary[],
  callbacks: {
    onFailed: (paths: string[], value: boolean, retry: () => void) => void;
    onApplied: (change: ViewedChange, undo: () => void) => void;
  },
) {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const savedState = useMemo(() => new Map(files.map(file => [file.path, file.viewed])), [files]);
  const isViewed = useCallback(
    (path: string) => overrides.get(path) ?? savedState.get(path) ?? false,
    [overrides, savedState],
  );
  const latestIsViewed = useRef(isViewed);
  useLayoutEffect(() => {
    latestIsViewed.current = isViewed;
  });
  const override = (paths: string[], valueFor: (path: string) => boolean) =>
    setOverrides(current => {
      const next = new Map(current);
      for (const path of paths) next.set(path, valueFor(path));
      return next;
    });

  const mutation = useMutation({
    mutationFn: async (change: ViewedChange) => {
      const results = await pool(change.paths, 6, path => source.setViewed(pullRequest!, path, change.value));
      return change.paths.filter((_path, index) => results[index]!.status === 'rejected');
    },
    onMutate: change => {
      const previous = new Map(change.paths.map(path => [path, latestIsViewed.current(path)]));
      override(change.paths, () => change.value);
      return { previous };
    },
    onSuccess: (failed, change, context) => {
      if (failed.length) {
        override(failed, path => context!.previous.get(path) ?? false);
        callbacks.onFailed(failed, change.value, () => setViewed(failed, change.value, { bulk: change.bulk }));
      }
      const applied = change.paths.filter(path => !failed.includes(path));
      if (applied.length)
        callbacks.onApplied({ ...change, paths: applied }, () =>
          setViewed(applied, !change.value, { bulk: change.bulk, undoable: false }),
        );
    },
  });

  const setViewed = useCallback(
    (paths: string[], value: boolean, options: { bulk?: boolean; undoable?: boolean } = {}) => {
      const changed = paths.filter(path => latestIsViewed.current(path) !== value);
      if (!changed.length || !pullRequest) return;
      mutation.mutate({
        paths: changed,
        value,
        bulk: options.bulk ?? changed.length > 1,
        undoable: options.undoable ?? changed.length > 1,
      });
    },
    [pullRequest, mutation],
  );

  return { isViewed, setViewed, saving: mutation.isPending };
}

/** Who has approved and whether the viewer may, plus the approve action itself. */
export function useApproval(
  source: ReviewSource,
  pullRequest: PullRequest | undefined,
  callbacks: { onApproved: () => void; onFailed: (error: Error, retry: () => void) => void },
) {
  const status = useQuery({
    queryKey: ['reviewStatus'],
    queryFn: () => source.loadReviewStatus(pullRequest!),
    enabled: !!pullRequest,
    staleTime: Infinity,
    retry: 1,
  });
  // Approve the head the files were loaded at, so GitHub refuses rather than approving commits nobody saw.
  const reviewedHead = pullRequest?.headCommitId ?? status.data?.headCommitId ?? null;
  const currentHead = status.data?.headCommitId;
  const mutation = useMutation({
    mutationFn: (headCommitId: string) => source.approve(pullRequest!, headCommitId),
    onSuccess: () => callbacks.onApproved(),
    onError: (error, headCommitId) => callbacks.onFailed(error, () => mutation.mutate(headCommitId)),
  });
  return {
    status: status.data,
    headMoved: !!reviewedHead && !!currentHead && reviewedHead !== currentHead,
    submitting: mutation.isPending || mutation.isSuccess,
    approve: () => {
      if (reviewedHead) mutation.mutate(reviewedHead);
    },
  };
}

const contentSlots = semaphore(4);

export const isImagePath = (path: string) => /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(path);

export function useImage(
  source: ReviewSource,
  pullRequest: PullRequest | undefined,
  path: string,
  side: FileSide,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['image', side, path],
    queryFn: () => contentSlots(() => source.loadImage(pullRequest!, path, side)),
    enabled: enabled && !!pullRequest,
    staleTime: Infinity,
    retry: 1,
  });
}

export function useFileContent(
  source: ReviewSource,
  pullRequest: PullRequest | undefined,
  path: string,
  side: FileSide,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['content', side, path],
    queryFn: () => contentSlots(() => source.loadFileContent(pullRequest!, path, side)),
    enabled: enabled && !!pullRequest,
    staleTime: Infinity,
    retry: 1,
  });
}
