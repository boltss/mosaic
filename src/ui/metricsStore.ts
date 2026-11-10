import { useSyncExternalStore } from 'react';
import {
  ActiveTimer,
  baseline,
  emptyRecord,
  loadRecord,
  loadRecords,
  updateRecord,
  type Baseline,
  type KeyValueStore,
  type PullRequestRecord,
} from '../metrics/metrics.ts';

/** What this pull request is, for the time summary. */
export interface SessionDescription {
  title: string;
  files: number;
  totalLines: number;
}

/** Per pull request session: ticking active time, which files were marked viewed in Mosaic, periodic persistence. */
export class MosaicSession {
  private unsavedSeconds = 0;
  private record: PullRequestRecord;
  private baseline: Baseline = { ready: false, pullRequests: 0, pace: null };
  private allRecords: PullRequestRecord[] = [];
  private mosaicPaths = new Set<string>();
  private bulkPaths = new Set<string>();
  private weights = new Map<string, number>();
  private description: SessionDescription = { title: '', files: 0, totalLines: 0 };
  private listeners = new Set<() => void>();
  private timer: ActiveTimer;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private version = 0;
  private stopped = false;

  constructor(
    private store: KeyValueStore,
    readonly key: string,
  ) {
    this.record = emptyRecord(key);
    this.timer = new ActiveTimer(
      { now: () => Date.now(), visible: () => document.visibilityState === 'visible' },
      () => {
        this.unsavedSeconds++;
        this.emit();
      },
    );
  }

  /** What this pull request is and how much each file weighs, for the time summary. */
  describe(weights: Map<string, number>, description: SessionDescription) {
    this.weights = weights;
    this.description = description;
  }

  async start() {
    const saved = await loadRecord(this.store, this.key);
    if (saved) {
      this.record = saved;
      this.mosaicPaths = new Set(saved.mosaicPaths ?? []);
      this.bulkPaths = new Set(saved.bulkPaths ?? []);
    }
    await this.refreshBaseline();
    if (this.stopped) return; // closed while storage was loading
    this.timer.start();
    this.flushInterval = setInterval(() => void this.flush(), 10_000);
    this.emit();
  }
  async refreshBaseline() {
    this.allRecords = await loadRecords(this.store);
    this.baseline = baseline(this.allRecords);
    this.emit();
  }
  poke() {
    this.timer.poke();
  }
  stop() {
    this.stopped = true;
    this.timer.stop();
    if (this.flushInterval) clearInterval(this.flushInterval);
    return this.flush();
  }

  marked(paths: string[], viewed: boolean, bulk: boolean) {
    for (const path of paths) {
      if (viewed) {
        this.mosaicPaths.add(path);
        if (bulk) this.bulkPaths.add(path);
        else this.bulkPaths.delete(path);
      } else {
        this.mosaicPaths.delete(path);
        this.bulkPaths.delete(path);
      }
    }
    this.emit();
  }
  private linesIn(paths: Set<string>) {
    let lines = 0;
    for (const path of paths) lines += this.weights.get(path) ?? 0;
    return lines;
  }
  /** Snapshot for display. */
  view() {
    return {
      seconds: this.record.mosaicSeconds + this.unsavedSeconds,
      mosaicLines: this.linesIn(this.mosaicPaths),
      bulkLines: this.linesIn(this.bulkPaths),
      bulkFiles: this.bulkPaths.size,
      oneByOneFiles: this.mosaicPaths.size - this.bulkPaths.size,
      baseline: this.baseline,
      allRecords: this.allRecords,
    };
  }
  async flush() {
    const seconds = this.unsavedSeconds;
    this.unsavedSeconds = 0;
    this.record = await updateRecord(this.store, this.key, record => {
      record.mosaicSeconds += seconds;
      if (this.description.files) {
        record.title = this.description.title;
        record.files = this.description.files;
        record.totalLines = this.description.totalLines;
      }
      record.mosaicPaths = [...this.mosaicPaths];
      record.bulkPaths = [...this.bulkPaths];
      record.mosaicLines = this.linesIn(this.mosaicPaths);
      record.bulkLines = this.linesIn(this.bulkPaths);
      record.bulkFiles = this.bulkPaths.size;
    });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

export function useSession(session: MosaicSession) {
  useSyncExternalStore(session.subscribe, session.getVersion);
  return session.view();
}
