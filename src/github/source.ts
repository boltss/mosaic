// GitHub implementation of ReviewSource using the user's browser session.
// The only module (with parse.ts and schemas.ts) that knows GitHub's internal endpoints.
import type { BackgroundRequest, BackgroundResponse } from '../shared/messages.ts';
import type {
  FileDiff,
  FileSide,
  PullRequest,
  PullRequestOverview,
  PullRequestReference,
  ReviewSource,
  ReviewStatus,
} from '../shared/types.ts';
import { parseUnifiedDiff } from './rawDiff.ts';
import {
  diffEntriesQuery,
  GitHubShapeError,
  parseChangesRoute,
  parseDiffEntries,
  parseReviewStatus,
  planBatches,
  type EntryDetails,
} from './parse.ts';

export interface SessionDependencies {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Relay to the background worker (needed for cross-origin redirects). */
  background: (request: BackgroundRequest) => Promise<BackgroundResponse>;
  /** Current `<meta name="fetch-nonce">` value, if any. */
  nonce: () => string | null;
  origin?: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    action: string,
  ) {
    super(`${action}: HTTP ${status}`);
    this.name = 'HttpError';
  }
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export class GitHubSessionSource implements ReviewSource {
  private origin: string;
  private entryDetails = new Map<string, EntryDetails>();
  constructor(
    private reference: PullRequestReference,
    private dependencies: SessionDependencies,
  ) {
    this.origin = dependencies.origin ?? 'https://github.com';
  }

  private baseUrl(reference: PullRequestReference = this.reference) {
    return `${this.origin}/${reference.owner}/${reference.repository}/pull/${reference.number}`;
  }

  private headers(json = true): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: json ? 'application/json' : 'text/html',
      'GitHub-Verified-Fetch': 'true',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (json) {
      headers['Content-Type'] = 'application/json';
      headers['GitHub-Is-React'] = 'true';
    }
    const nonce = this.dependencies.nonce();
    if (nonce) headers['X-Fetch-Nonce'] = nonce;
    return headers;
  }

  async loadPullRequest(): Promise<PullRequestOverview> {
    const response = await this.dependencies.fetch(`${this.baseUrl()}/changes`, {
      credentials: 'include',
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) throw new HttpError(response.status, 'loading the pull request changes page');
    const route = parseChangesRoute(await response.text());
    const pullRequest: PullRequest = {
      ...this.reference,
      title: route.title,
      range: route.range,
      headCommitId: route.headCommitId,
      baseCommitId: route.baseCommitId,
    };
    return { pullRequest, files: route.summaries };
  }

  planDiffBatches(paths: string[]) {
    return planBatches(paths);
  }

  async loadDiffBatch(pullRequest: PullRequest, paths: string[]): Promise<FileDiff[]> {
    const url = `${this.baseUrl(pullRequest)}/page_data/diff_entries?${diffEntriesQuery(paths, pullRequest.range)}`;
    const response = await this.dependencies.fetch(url, { credentials: 'include', headers: this.headers() });
    if (!response.ok) throw new HttpError(response.status, 'loading diffs');
    const { diffs, details } = parseDiffEntries(await response.json());
    for (const [path, entry] of details) this.entryDetails.set(path, entry);
    return diffs;
  }

  async loadRawDiff(pullRequest: PullRequest): Promise<Map<string, FileDiff>> {
    const response = await this.dependencies.background({
      type: 'rawDiff',
      owner: pullRequest.owner,
      repository: pullRequest.repository,
      number: pullRequest.number,
    });
    if (!response.ok) throw new Error(`loading the full .diff failed: ${response.error}`);
    if (response.status !== 200 || response.text == null)
      throw new HttpError(response.status, 'loading the full .diff');
    if (!/^diff --git /m.test(response.text) && response.text.trim() !== '')
      throw new GitHubShapeError('the .diff response is not a diff');
    return parseUnifiedDiff(response.text);
  }

  async setViewed(pullRequest: PullRequest, path: string, viewed: boolean): Promise<void> {
    const response = await this.dependencies.fetch(`${this.baseUrl(pullRequest)}/file_review`, {
      method: viewed ? 'POST' : 'DELETE',
      credentials: 'include',
      headers: this.headers(),
      body: JSON.stringify(viewed ? { path, viewed: 'viewed' } : { path, _method: 'delete' }),
    });
    if (!response.ok) throw new HttpError(response.status, viewed ? 'marking viewed' : 'unmarking viewed');
  }

  async loadReviewStatus(pullRequest: PullRequest): Promise<ReviewStatus> {
    const response = await this.dependencies.fetch(this.baseUrl(pullRequest), {
      credentials: 'include',
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) throw new HttpError(response.status, 'loading the pull request conversation page');
    return parseReviewStatus(await response.text());
  }

  /** The request GitHub's own "Review changes → Approve" sends. */
  async approve(pullRequest: PullRequest, headCommitId: string): Promise<void> {
    const response = await this.dependencies.fetch(`${this.baseUrl(pullRequest)}/page_data/submit_review`, {
      method: 'PUT',
      credentials: 'include',
      headers: this.headers(),
      body: JSON.stringify({ body: '', event: 'approve', headSha: headCommitId }),
    });
    if (!response.ok) throw new HttpError(response.status, 'approving');
  }

  /** URL of a file as it was at the base ("old") or is at the head ("new") of the pull request. */
  private rawUrl(pullRequest: PullRequest, path: string, side: FileSide) {
    const entry = this.entryDetails.get(path);
    const commitId =
      side === 'old'
        ? (entry?.oldCommitId ?? pullRequest.baseCommitId)
        : (entry?.newCommitId ?? pullRequest.headCommitId);
    if (!commitId) return null;
    const filePath = side === 'old' ? (entry?.oldPath ?? path) : path;
    return `${this.origin}/${pullRequest.owner}/${pullRequest.repository}/raw/${commitId}/${encodePath(filePath)}`;
  }

  async loadFileContent(pullRequest: PullRequest, path: string, side: FileSide): Promise<string | null> {
    const url = this.rawUrl(pullRequest, path, side);
    if (!url) return null;
    const response = await this.dependencies.background({ type: 'rawFile', url });
    if (!response.ok) throw new Error(response.error);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new HttpError(response.status, `loading ${side} ${path}`);
    return response.text;
  }

  async loadImage(pullRequest: PullRequest, path: string, side: FileSide) {
    const url = this.rawUrl(pullRequest, path, side);
    if (!url) return null;
    const response = await this.dependencies.background({ type: 'rawImage', url });
    if (!response.ok) throw new Error(response.error);
    if (response.status === 404) return null;
    if (response.status !== 200 || !response.dataUrl) throw new HttpError(response.status, `loading ${side} ${path}`);
    return { url: response.dataUrl, bytes: response.bytes ?? 0 };
  }

  blobUrl(pullRequest: PullRequest, path: string, kind: 'blob' | 'raw') {
    const commitId = this.entryDetails.get(path)?.newCommitId ?? pullRequest.headCommitId ?? 'HEAD';
    return `${this.origin}/${pullRequest.owner}/${pullRequest.repository}/${kind}/${commitId}/${encodePath(path)}`;
  }

  githubUrl(pullRequest: PullRequest, path?: string) {
    // GitHub's changes view supports deep links by file path digest; the plain path filter works everywhere.
    return path
      ? `${this.baseUrl(pullRequest)}/changes?file-filters%5B%5D=&file=${encodeURIComponent(path)}`
      : `${this.baseUrl(pullRequest)}/changes`;
  }
}

export function pullRequestFromPath(pathname: string): PullRequestReference | null {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  return match ? { owner: match[1]!, repository: match[2]!, number: Number(match[3]) } : null;
}
