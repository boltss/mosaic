// The shapes of GitHub's internal (undocumented) pull request page data, exactly as far as Mosaic
// relies on them. Fields Mosaic must have are required; fields GitHub sometimes leaves out are
// nullish but still typed, so a field that changes type fails here instead of rendering wrong data.
// Objects are loose: GitHub sends many more keys than these and adds new ones all the time.
import * as zod from 'zod';

export const embeddedPayloadSchema = zod.record(zod.string(), zod.unknown());
export type EmbeddedPayload = zod.infer<typeof embeddedPayloadSchema>;

export const diffSummarySchema = zod.looseObject({
  path: zod.string(),
  markedAsViewed: zod.boolean(),
  changeType: zod.string().nullish(),
  linesAdded: zod.number().nullish(),
  linesDeleted: zod.number().nullish(),
  isVendored: zod.boolean().nullish(),
});

export const changesRouteSchema = zod.looseObject({
  diffSummaries: zod.array(diffSummarySchema),
  pullRequest: zod.looseObject({ title: zod.string().nullish() }).nullish(),
  comparison: zod.looseObject({ range: zod.string().nullish() }).nullish(),
});
export type ChangesRoutePayload = zod.infer<typeof changesRouteSchema>;

export const changesPageSchema = zod.looseObject({
  title: zod.string().nullish(),
  payload: zod.looseObject({ pullRequestsChangesRoute: changesRouteSchema }),
});

const treeEntrySchema = zod.looseObject({
  path: zod.string().nullish(),
  isGenerated: zod.boolean().nullish(),
});

export const diffEntryLineSchema = zod.looseObject({
  type: zod.string().nullish(),
  text: zod.string().nullish(),
  html: zod.string().nullish(),
  left: zod.number().nullish(),
  right: zod.number().nullish(),
});
export type DiffEntryLine = zod.infer<typeof diffEntryLineSchema>;

export const diffEntrySchema = zod.looseObject({
  path: zod.string(),
  diffLines: zod.array(diffEntryLineSchema).nullish(),
  isBinary: zod.boolean().nullish(),
  isTooBig: zod.boolean().nullish(),
  truncatedReason: zod.string().nullish(),
  linesChanged: zod.number().nullish(),
  oldTreeEntry: treeEntrySchema.nullish(),
  newTreeEntry: treeEntrySchema.nullish(),
  oldCommitOid: zod.string().nullish(),
  newCommitOid: zod.string().nullish(),
});

export const diffEntriesSchema = zod.array(diffEntrySchema);
