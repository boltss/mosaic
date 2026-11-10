// Service worker: fetches that must follow cross-origin redirects with the user's
// github.com session (.diff -> patch-diff.githubusercontent.com, raw -> raw.githubusercontent.com).
import {
  backgroundRequestSchema,
  type BackgroundRequest,
  type BackgroundResponse,
  type ToggleMessage,
} from '../shared/messages.ts';

const ALLOWED_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull\/\d+\.diff|raw\/[0-9a-f]{40,64}\/.+)$/;

async function fetchText(url: string): Promise<BackgroundResponse> {
  if (!ALLOWED_URL.test(url)) return { ok: false, error: 'URL not allowed' };
  try {
    const response = await fetch(url, { credentials: 'include', redirect: 'follow' });
    return { ok: true, status: response.status, text: response.ok ? await response.text() : null };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};
const MAXIMUM_IMAGE_BYTES = 12 * 1024 * 1024;
const BASE64_CHUNK_BYTES = 0x8000;

/** An image as a data: URL, so the page can show it whatever its content-security policy allows. */
async function fetchImage(url: string): Promise<BackgroundResponse> {
  const type = IMAGE_TYPES[url.slice(url.lastIndexOf('.') + 1).toLowerCase()];
  if (!ALLOWED_URL.test(url) || !type) return { ok: false, error: 'URL not allowed' };
  try {
    const response = await fetch(url, { credentials: 'include', redirect: 'follow' });
    if (!response.ok) return { ok: true, status: response.status, text: null };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAXIMUM_IMAGE_BYTES) return { ok: false, error: 'image too large to preview' };
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
    return {
      ok: true,
      status: 200,
      text: null,
      dataUrl: `data:${type};base64,${btoa(binary)}`,
      bytes: bytes.length,
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function respond(request: BackgroundRequest): Promise<BackgroundResponse> {
  switch (request.type) {
    case 'rawDiff':
      return fetchText(
        `https://github.com/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repository)}/pull/${request.number}.diff`,
      );
    case 'rawFile':
      return fetchText(request.url);
    case 'rawImage':
      return fetchImage(request.url);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only our own content scripts on github.com may use the relay.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith('https://github.com/')) return false;
  const request = backgroundRequestSchema.safeParse(message);
  if (!request.success) return false;
  void respond(request.data).then(sendResponse);
  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-mosaic') return;
  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'toggleMosaic' } satisfies ToggleMessage).catch(() => {});
});
