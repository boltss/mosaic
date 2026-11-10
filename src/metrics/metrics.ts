// Active-time measurement and "time saved" maths. Stored locally only.
import * as zod from 'zod';

export const IDLE_AFTER_MILLISECONDS = 60_000;

export interface Clock {
  now(): number;
  visible(): boolean;
}

/** Counts whole seconds while the page is visible and the user acted in the last minute. */
export class ActiveTimer {
  private lastInput = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  constructor(
    private clock: Clock,
    private onSecond: () => void,
  ) {}
  poke() {
    this.lastInput = this.clock.now();
  }
  isActive() {
    return this.clock.visible() && this.clock.now() - this.lastInput < IDLE_AFTER_MILLISECONDS;
  }
  /** One tick; exposed for tests. */
  tick() {
    if (this.isActive()) this.onSecond();
  }
  start() {
    if (!this.interval) {
      this.poke();
      this.interval = setInterval(() => this.tick(), 1000);
    }
  }
  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

/** Records written before the fields were spelled out used shortened names; read them as the current ones. */
const LEGACY_RECORD_FIELDS: Record<string, string> = { mosaicSec: 'mosaicSeconds', githubSec: 'githubSeconds' };

function renameLegacyFields(value: unknown, legacyFields: Record<string, string>): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const renamed: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) renamed[legacyFields[key] ?? key] = fieldValue;
  return renamed;
}

/** What Mosaic remembers about one pull request, in this browser only. */
export const pullRequestRecordSchema = zod.preprocess(
  value => renameLegacyFields(value, LEGACY_RECORD_FIELDS),
  zod.object({
    key: zod.string(),
    title: zod.string().default(''),
    files: zod.number().default(0),
    totalLines: zod.number().default(0),
    /** Active seconds in Mosaic. */
    mosaicSeconds: zod.number().default(0),
    /** Changed lines marked viewed while in Mosaic (one by one + bulk). */
    mosaicLines: zod.number().default(0),
    bulkLines: zod.number().default(0),
    bulkFiles: zod.number().default(0),
    /** Active seconds in GitHub's own files view. */
    githubSeconds: zod.number().default(0),
    /** Changed lines the user marked viewed in GitHub's own view. */
    githubLines: zod.number().default(0),
    updatedAt: zod.number().default(0),
    /** Files marked viewed in Mosaic, and the ones among them cleared in bulk. */
    mosaicPaths: zod.array(zod.string()).optional(),
    bulkPaths: zod.array(zod.string()).optional(),
    /** Files marked viewed in GitHub's own view. */
    githubPaths: zod.array(zod.string()).optional(),
  }),
);
export type PullRequestRecord = zod.infer<typeof pullRequestRecordSchema>;

export const emptyRecord = (key: string): PullRequestRecord => pullRequestRecordSchema.parse({ key });

/** Storage keys of pull request records start with this. */
export const RECORD_KEY_PREFIX = 'pr:';
export const pullRequestKey = (owner: string, repository: string, number: number) =>
  `${RECORD_KEY_PREFIX}${owner}/${repository}#${number}`.toLowerCase();

export const MINIMUM_BASELINE_SECONDS = 5 * 60;
export const MINIMUM_BASELINE_PULL_REQUESTS = 3;

export interface Baseline {
  ready: boolean;
  pullRequests: number;
  /** minutes per 100 changed lines */
  pace: number | null;
}

/** Pooled GitHub-native pace from pull requests with enough GitHub-view activity. */
export function baseline(records: PullRequestRecord[]): Baseline {
  const usable = records.filter(record => record.githubSeconds >= MINIMUM_BASELINE_SECONDS && record.githubLines > 0);
  if (!usable.length) return { ready: false, pullRequests: 0, pace: null };
  const minutes = usable.reduce((sum, record) => sum + record.githubSeconds / 60, 0);
  const hundredsOfLines = usable.reduce((sum, record) => sum + record.githubLines / 100, 0);
  return {
    ready: usable.length >= MINIMUM_BASELINE_PULL_REQUESTS,
    pullRequests: usable.length,
    pace: minutes / hundredsOfLines,
  };
}

/** Minutes saved = what the viewed lines would have cost at the GitHub pace − time spent in Mosaic. */
export function savedMinutes(
  record: Pick<PullRequestRecord, 'mosaicLines' | 'mosaicSeconds'>,
  measured: Baseline,
): number | null {
  if (!measured.ready || measured.pace == null) return null;
  return (record.mosaicLines / 100) * measured.pace - record.mosaicSeconds / 60;
}

export function estimateGithubMinutes(lines: number, measured: Baseline): number | null {
  return measured.ready && measured.pace != null ? (lines / 100) * measured.pace : null;
}

export const WEEK_MILLISECONDS = 7 * 24 * 3600 * 1000;
export const thisWeek = (records: PullRequestRecord[], now: number) =>
  records
    .filter(record => record.mosaicSeconds > 0 && now - record.updatedAt < WEEK_MILLISECONDS)
    .toSorted((first, second) => second.updatedAt - first.updatedAt);

export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export const formatMinutes = (minutes: number) => {
  const rounded = Math.round(Math.abs(minutes));
  return rounded >= 60 ? `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, '0')}m` : `${rounded} min`;
};

// ---- storage ----
/** Values come back as `unknown`: whoever reads them validates them with a schema. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  all(prefix: string): Promise<unknown[]>;
}

export const chromeStore: KeyValueStore = {
  async get(key) {
    return (await chrome.storage.local.get(key))[key];
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async all(prefix) {
    return Object.entries(await chrome.storage.local.get(null))
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value);
  },
};

export function memoryStore(seed: Record<string, unknown> = {}): KeyValueStore {
  const values = new Map(Object.entries(seed));
  return {
    async get(key) {
      return values.get(key);
    },
    async set(key, value) {
      values.set(key, value);
    },
    async all(prefix) {
      return [...values].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
    },
  };
}

/** A stored record, or null when there is none or it no longer matches the schema (reported, then ignored). */
function readRecord(value: unknown): PullRequestRecord | null {
  if (value == null) return null;
  const result = pullRequestRecordSchema.safeParse(value);
  if (result.success) return result.data;
  console.warn('[Mosaic] ignoring a stored record that does not match the schema', zod.prettifyError(result.error));
  return null;
}

export async function loadRecord(store: KeyValueStore, key: string): Promise<PullRequestRecord | null> {
  return readRecord(await store.get(key));
}

export async function loadRecords(store: KeyValueStore): Promise<PullRequestRecord[]> {
  return (await store.all(RECORD_KEY_PREFIX)).map(readRecord).filter(record => record != null);
}

/** Read-modify-write helper. Concurrent tabs may race; last write wins, which is acceptable for local stats. */
export async function updateRecord(
  store: KeyValueStore,
  key: string,
  update: (record: PullRequestRecord) => void,
): Promise<PullRequestRecord> {
  const record = (await loadRecord(store, key)) ?? emptyRecord(key);
  update(record);
  record.updatedAt = Date.now();
  await store.set(key, record);
  return record;
}
