// Pure parsers for GitHub's internal (undocumented) pull request page data. Every shape GitHub
// gives us is checked against the schemas in schemas.ts; anything unexpected throws GitHubShapeError
// naming the exact field, so the UI can say "GitHub changed something" instead of rendering wrong data.
import type * as zod from 'zod';
import type { Approval, DiffLine, FileDiff, FileStatus, FileSummary, LineKind, ReviewStatus } from '../shared/types.ts';
import {
  changesPageSchema,
  diffEntriesSchema,
  embeddedPayloadSchema,
  layoutPageSchema,
  type DiffEntryLine,
  type EmbeddedPayload,
} from './schemas.ts';

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in to GitHub');
    this.name = 'NotLoggedInError';
  }
}

export class GitHubShapeError extends Error {
  constructor(description: string) {
    super(`Unexpected GitHub response: ${description}`);
    this.name = 'GitHubShapeError';
  }
}

/** Validate a GitHub response; a mismatch becomes a GitHubShapeError listing each offending field. */
function parseShape<Schema extends zod.ZodType>(schema: Schema, value: unknown, name: string): zod.output<Schema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const problems = result.error.issues.map(issue => {
    const location = issue.path.map(key => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('');
    return `${name}${location}: ${issue.message}`;
  });
  throw new GitHubShapeError(problems.slice(0, 5).join('; '));
}

/** All embedded React payloads (`<script data-target="…embeddedData">`) in a GitHub HTML page. */
export function embeddedPayloads(html: string): EmbeddedPayload[] {
  const payloads: EmbeddedPayload[] = [];
  const scriptPattern = /<script\b[^>]*data-target="[^"]*embeddedData"[^>]*>([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const payload = embeddedPayloadSchema.safeParse(JSON.parse(match[1]!));
      if (payload.success) payloads.push(payload.data);
    } catch {
      /* not ours */
    }
  }
  return payloads;
}

export interface ChangesRoute {
  title: string;
  summaries: FileSummary[];
  range: string | null;
  headCommitId: string | null;
  baseCommitId: string | null;
}

const COMMIT_ID = /^[0-9a-f]{40}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Depth-limited search for the first commit id under a key matching `keyPattern`. */
function findCommitId(value: unknown, keyPattern: RegExp, depth = 4): string | null {
  if (!isRecord(value) || depth < 0) return null;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && COMMIT_ID.test(child) && keyPattern.test(key)) return child;
  }
  for (const child of Object.values(value)) {
    const found = findCommitId(child, keyPattern, depth - 1);
    if (found) return found;
  }
  return null;
}

export function statusFromChangeType(changeType: unknown): FileStatus {
  const name = String(changeType ?? '').toUpperCase();
  if (name.startsWith('ADD')) return 'added';
  if (name.startsWith('DELET') || name.startsWith('REMOV')) return 'deleted';
  if (name.startsWith('RENAM') || name.startsWith('COP')) return 'renamed';
  return 'modified';
}

export function parseChangesRoute(html: string): ChangesRoute {
  const page = embeddedPayloads(html).find(
    payload => isRecord(payload.payload) && isRecord(payload.payload.pullRequestsChangesRoute),
  );
  if (!page) {
    if (/<meta name="user-login" content="">/.test(html) || !/<meta name="user-login"/.test(html))
      throw new NotLoggedInError();
    throw new GitHubShapeError('no pullRequestsChangesRoute in the changes page');
  }
  const parsed = parseShape(changesPageSchema, page, 'changes page');
  const route = parsed.payload.pullRequestsChangesRoute;
  const summaries = route.diffSummaries.map((summary): FileSummary => ({
    path: summary.path,
    status: statusFromChangeType(summary.changeType),
    additions: summary.linesAdded ?? 0,
    deletions: summary.linesDeleted ?? 0,
    viewed: summary.markedAsViewed,
    isVendored: summary.isVendored === true || undefined,
  }));
  const headCommitId = findCommitId(route.comparison, /head|end|new|tip/i) ?? findCommitId(route.pullRequest, /head/i);
  const baseCommitId = findCommitId(route.comparison, /base|start|old/i) ?? findCommitId(route.pullRequest, /base/i);
  return {
    title: route.pullRequest?.title ?? parsed.title ?? '',
    summaries,
    range: route.comparison?.range ?? headCommitId,
    headCommitId,
    baseCommitId,
  };
}

const userLogin = (html: string) => html.match(/<meta name="user-login" content="([^"]*)"/)?.[1] ?? '';

/**
 * Parse the conversation page: whether the viewer may approve (from the embedded layout payload) and
 * who already has (from the Reviewers sidebar, where each approval is a link to the commit it was
 * given on with an "<login> approved these changes" tooltip).
 */
export function parseReviewStatus(html: string): ReviewStatus {
  const page = embeddedPayloads(html).find(
    payload => isRecord(payload.payload) && isRecord(payload.payload.pullRequestsLayoutRoute),
  );
  if (!page) {
    if (!userLogin(html)) throw new NotLoggedInError();
    throw new GitHubShapeError('no pullRequestsLayoutRoute in the conversation page');
  }
  const { pullRequest } = parseShape(layoutPageSchema, page, 'conversation page').payload.pullRequestsLayoutRoute;
  const headCommitId = pullRequest.headSha ?? null;
  const viewer = userLogin(html).toLowerCase();
  const tooltips = new Map(
    [...html.matchAll(/<tool-tip\b[^>]*\bfor="review-status-([^"]+)"[^>]*>([^<]*)</g)].map(([, login, text]) => [
      login!,
      text!,
    ]),
  );
  const approvals: Approval[] = [];
  for (const [link, login] of html.matchAll(/<a\b[^>]*\bid="review-status-([^"]+)"[^>]*>/g)) {
    if (!tooltips.get(login!)?.includes('approved these changes')) continue;
    const commitId = link.match(/href="[^"]*\/files\/([0-9a-f]{40})"/)?.[1];
    approvals.push({
      login: login!,
      isViewer: login!.toLowerCase() === viewer,
      stale: !!commitId && !!headCommitId && commitId !== headCommitId,
    });
  }
  return {
    canApprove: pullRequest.viewerAllowedNonCommentReviewTypes.includes('APPROVE'),
    headCommitId,
    approvals,
  };
}

export function lineKind(type: unknown): LineKind {
  const name = String(type ?? '').toLowerCase();
  if (name.includes('hunk')) return 'hunk';
  if (name === '+' || name.startsWith('add') || name.includes('insert')) return 'addition';
  if (name === '-' || name.startsWith('del') || name.includes('remov')) return 'deletion';
  return 'context';
}

/** What a diff entry says about a file beyond its lines: where it was and at which commits. */
export interface EntryDetails {
  oldPath?: string;
  oldCommitId?: string;
  newCommitId?: string;
}

function toDiffLine(line: DiffEntryLine): DiffLine {
  const kind = lineKind(line.type);
  const left = line.left ?? 0;
  const right = line.right ?? 0;
  return {
    kind,
    text: line.text ?? '',
    html: line.html ?? undefined,
    oldNumber: kind !== 'addition' && kind !== 'hunk' && left > 0 ? left : undefined,
    newNumber: kind !== 'deletion' && kind !== 'hunk' && right > 0 ? right : undefined,
  };
}

/** Parse a `page_data/diff_entries` response. */
export function parseDiffEntries(json: unknown): { diffs: FileDiff[]; details: Map<string, EntryDetails> } {
  const entries = parseShape(diffEntriesSchema, json, 'diff_entries');
  const diffs: FileDiff[] = [];
  const details = new Map<string, EntryDetails>();
  for (const entry of entries) {
    const lines = (entry.diffLines ?? []).map(toDiffLine);
    stripMarkers(lines);
    const isBinary = entry.isBinary === true;
    const tooBig = entry.isTooBig === true || (entry.truncatedReason != null && entry.truncatedReason !== '');
    diffs.push({
      path: entry.path,
      lines,
      source: 'entries',
      binary: isBinary,
      isGenerated: entry.newTreeEntry?.isGenerated === true || undefined,
      // A non-binary file with changes but no lines came back empty: treat as incomplete.
      complete: !tooBig && (isBinary || lines.length > 0 || (entry.linesChanged ?? 0) === 0),
    });
    const oldPath = entry.oldTreeEntry?.path;
    details.set(entry.path, {
      oldPath: oldPath != null && oldPath !== entry.path ? oldPath : undefined,
      oldCommitId: entry.oldCommitOid ?? undefined,
      newCommitId: entry.newCommitOid ?? undefined,
    });
  }
  return { diffs, details };
}

/** If every added/removed/context line carries its +/-/space marker, drop it — from the highlighted html too,
 *  which starts with the same bare character (blank lines come through as just `<br>`). */
function stripMarkers(lines: DiffLine[]) {
  const body = lines.filter(line => line.kind !== 'hunk');
  if (!body.length) return;
  const marker = (line: DiffLine) => (line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' ');
  if (!body.every(line => line.text[0] === marker(line))) return;
  for (const line of body) {
    line.text = line.text.slice(1);
    if (line.html?.[0] === marker(line)) line.html = line.html.slice(1);
  }
}

/** Split paths into diff_entries batches whose encoded `paths=` value stays under maximumLength. */
export function planBatches(paths: string[], maximumLength = 6000, maximumFiles = 40): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const path of paths) {
    const pieceLength = encodeURIComponent(encodeURIComponent(path)).length + 3; // + encoded comma
    if (current.length && (length + pieceLength > maximumLength || current.length >= maximumFiles)) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(path);
    length += pieceLength;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function diffEntriesQuery(paths: string[], range: string | null): string {
  const query = new URLSearchParams();
  query.set('paths', paths.map(encodeURIComponent).join(','));
  query.set('ctx', ':::');
  query.set('w', '0');
  if (range) query.set('range', range);
  return query.toString();
}
