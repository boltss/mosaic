// The review model every part of Mosaic shares. Each shape is a Zod schema with its type inferred from it,
// so there is exactly one definition of what a file, a diff line or a pull request looks like.
import * as zod from 'zod';

export const fileStatusSchema = zod.enum(['added', 'modified', 'deleted', 'renamed']);
export type FileStatus = zod.infer<typeof fileStatusSchema>;

export const pullRequestReferenceSchema = zod.object({
  owner: zod.string().min(1),
  repository: zod.string().min(1),
  number: zod.number().int().positive(),
});
export type PullRequestReference = zod.infer<typeof pullRequestReferenceSchema>;

export const pullRequestSchema = pullRequestReferenceSchema.extend({
  title: zod.string(),
  /** Commit range or commit id GitHub expects in `diff_entries?range=`. */
  range: zod.string().nullable(),
  headCommitId: zod.string().nullable(),
  baseCommitId: zod.string().nullable(),
});
export type PullRequest = zod.infer<typeof pullRequestSchema>;

export const fileSummarySchema = zod.object({
  path: zod.string(),
  oldPath: zod.string().optional(),
  status: fileStatusSchema,
  additions: zod.number(),
  deletions: zod.number(),
  viewed: zod.boolean(),
  isGenerated: zod.boolean().optional(),
  isVendored: zod.boolean().optional(),
});
export type FileSummary = zod.infer<typeof fileSummarySchema>;

export const lineKindSchema = zod.enum(['addition', 'deletion', 'context', 'hunk']);
export type LineKind = zod.infer<typeof lineKindSchema>;

export const diffLineSchema = zod.object({
  kind: lineKindSchema,
  text: zod.string(),
  /** Syntax-highlighted HTML from GitHub (sanitised before render). */
  html: zod.string().optional(),
  oldNumber: zod.number().optional(),
  newNumber: zod.number().optional(),
});
export type DiffLine = zod.infer<typeof diffLineSchema>;

export const fileDiffSchema = zod.object({
  path: zod.string(),
  lines: zod.array(diffLineSchema),
  /** false when GitHub truncated or refused the diff and it must be completed elsewhere. */
  complete: zod.boolean(),
  binary: zod.boolean().optional(),
  isGenerated: zod.boolean().optional(),
  source: zod.enum(['entries', 'raw']),
  /** Set when the shown lines don't match GitHub's per-file line counts. */
  warning: zod.string().optional(),
});
export type FileDiff = zod.infer<typeof fileDiffSchema>;

export const pullRequestOverviewSchema = zod.object({
  pullRequest: pullRequestSchema,
  files: zod.array(fileSummarySchema),
});
export type PullRequestOverview = zod.infer<typeof pullRequestOverviewSchema>;

export const fileSideSchema = zod.enum(['old', 'new']);
/** The base ("old") or the head ("new") of the pull request. */
export type FileSide = zod.infer<typeof fileSideSchema>;

export const loadedImageSchema = zod.object({ url: zod.string(), bytes: zod.number() });
export type LoadedImage = zod.infer<typeof loadedImageSchema>;

export const approvalSchema = zod.object({
  login: zod.string(),
  isViewer: zod.boolean(),
  /** Given on an earlier commit than the current head. */
  stale: zod.boolean(),
});
export type Approval = zod.infer<typeof approvalSchema>;

export const reviewStatusSchema = zod.object({
  /** GitHub lets the viewer approve: not their own pull request, still open, and they have access. */
  canApprove: zod.boolean(),
  /** The pull request head right now; differs from the reviewed head when commits were pushed since. */
  headCommitId: zod.string().nullable(),
  approvals: zod.array(approvalSchema),
});
export type ReviewStatus = zod.infer<typeof reviewStatusSchema>;

/** Everything the UI needs from a code host. GitHub session adapter and the dev harness implement it. */
export interface ReviewSource {
  loadPullRequest(): Promise<PullRequestOverview>;
  /** Paths grouped into request-sized batches. */
  planDiffBatches(paths: string[]): string[][];
  loadDiffBatch(pullRequest: PullRequest, paths: string[]): Promise<FileDiff[]>;
  /** Complete unified diff of the pull request, parsed per file. */
  loadRawDiff(pullRequest: PullRequest): Promise<Map<string, FileDiff>>;
  setViewed(pullRequest: PullRequest, path: string, viewed: boolean): Promise<void>;
  /** Whole file content at one side of the pull request; null when it does not exist. */
  loadFileContent(pullRequest: PullRequest, path: string, side: FileSide): Promise<string | null>;
  /** An image file at one side of the pull request as something an <img> can show; null when it does not exist. */
  loadImage(pullRequest: PullRequest, path: string, side: FileSide): Promise<LoadedImage | null>;
  /** Whether the viewer may approve, and who already has. */
  loadReviewStatus(pullRequest: PullRequest): Promise<ReviewStatus>;
  /** Submit an approving review of `headCommitId`; GitHub refuses it if the head has moved on. */
  approve(pullRequest: PullRequest, headCommitId: string): Promise<void>;
  /** URL of a file at the pull request head, for links/images in previews. */
  blobUrl(pullRequest: PullRequest, path: string, kind: 'blob' | 'raw'): string;
  githubUrl(pullRequest: PullRequest, path?: string): string;
}

export interface LogoTile {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The Mosaic mark: three uneven tiles on a 16×16 grid. */
export const LOGO_TILES: LogoTile[] = [
  { left: 1, top: 1, width: 6, height: 14 },
  { left: 9, top: 1, width: 6, height: 5 },
  { left: 9, top: 8, width: 6, height: 7 },
];
