// Messages between the content script / UI, the page hook and the background service worker.
// Every message is validated where it is received, so a mismatch fails at the boundary.
import * as zod from 'zod';

export const backgroundRequestSchema = zod.discriminatedUnion('type', [
  zod.object({
    type: zod.literal('rawDiff'),
    owner: zod.string().min(1),
    repository: zod.string().min(1),
    number: zod.number().int().positive(),
  }),
  zod.object({ type: zod.literal('rawFile'), url: zod.string() }),
  zod.object({ type: zod.literal('rawImage'), url: zod.string() }),
]);
export type BackgroundRequest = zod.infer<typeof backgroundRequestSchema>;

export const backgroundResponseSchema = zod.discriminatedUnion('ok', [
  zod.object({
    ok: zod.literal(true),
    status: zod.number(),
    text: zod.string().nullable(),
    /** rawImage only: the file as a data: URL. */
    dataUrl: zod.string().optional(),
    bytes: zod.number().optional(),
  }),
  zod.object({ ok: zod.literal(false), error: zod.string() }),
]);
export type BackgroundResponse = zod.infer<typeof backgroundResponseSchema>;

/** Sent from the background worker to a tab when the keyboard command fires. */
export const toggleMessageSchema = zod.object({ type: zod.literal('toggleMosaic') });
export type ToggleMessage = zod.infer<typeof toggleMessageSchema>;

/** Posted by the page hook when the user ticks "Viewed" in GitHub's own files view. */
export const fileReviewMessageSchema = zod.object({
  source: zod.literal('mosaic-hook'),
  type: zod.literal('file_review'),
  path: zod.string(),
  viewed: zod.boolean(),
});
export type FileReviewMessage = zod.infer<typeof fileReviewMessageSchema>;

export async function askBackground(request: BackgroundRequest): Promise<BackgroundResponse> {
  return backgroundResponseSchema.parse(await chrome.runtime.sendMessage(request));
}
