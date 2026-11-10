// Content script on github.com: launcher pill, overlay lifecycle, and GitHub-native time measurement.
import * as zod from 'zod';
import { embeddedPayloads, parseChangesRoute } from '../github/parse.ts';
import { GitHubSessionSource, pullRequestFromPath } from '../github/source.ts';
import { ActiveTimer, chromeStore, pullRequestKey, updateRecord } from '../metrics/metrics.ts';
import { askBackground, fileReviewMessageSchema, toggleMessageSchema } from '../shared/messages.ts';
import { LOGO_TILES, type PullRequestReference } from '../shared/types.ts';
import type { mountMosaic } from '../ui/entry.tsx';

/** The UI bundle is loaded on demand; check it exports what this script is about to call. */
const uiModuleSchema = zod.object({
  mountMosaic: zod.custom<typeof mountMosaic>(value => typeof value === 'function'),
});

let host: HTMLElement | null = null;
let unmount: (() => void) | null = null;
let openPullRequest: string | null = null;
let savedOverflow = '';

const theme = (): 'light' | 'dark' => {
  const mode = document.documentElement.dataset.colorMode;
  if (mode === 'light' || mode === 'dark') return mode;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
const pullRequestId = (reference: PullRequestReference) =>
  `${reference.owner}/${reference.repository}#${reference.number}`;
const recordKey = (reference: PullRequestReference) =>
  pullRequestKey(reference.owner, reference.repository, reference.number);

/**
 * GitHub's own page keeps working underneath Mosaic: its scripts and observers react to every scroll
 * and its DOM takes part in every layout. Taking it out of rendering while Mosaic is open removes
 * that cost; the scroll position is put back on close.
 */
let parkedScroll: number | null = null;
function parkGitHub(parked: boolean) {
  if (parked === (parkedScroll != null)) return;
  if (parked) {
    parkedScroll = window.scrollY;
    document.body.style.setProperty('display', 'none', 'important');
  } else {
    document.body.style.removeProperty('display');
    window.scrollTo(0, parkedScroll!);
    parkedScroll = null;
  }
}

async function openMosaic() {
  const reference = pullRequestFromPath(location.pathname);
  if (!reference || host) return;
  openPullRequest = pullRequestId(reference);
  const ownHost = (host = document.createElement('div'));
  ownHost.id = 'mosaic-review-root';
  document.documentElement.append(ownHost);
  savedOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  updatePill();
  try {
    const ui = uiModuleSchema.parse(await import(chrome.runtime.getURL('ui.js')));
    if (host !== ownHost) return; // closed (or reopened) while the UI was loading
    const source = new GitHubSessionSource(reference, {
      fetch: (url, init) => fetch(url, init),
      background: askBackground,
      nonce: () => document.querySelector<HTMLMetaElement>('meta[name="fetch-nonce"]')?.content ?? null,
    });
    unmount = ui.mountMosaic(ownHost, { source, store: chromeStore, theme: theme(), onClose: closeMosaic });
    parkGitHub(true);
  } catch (error) {
    console.error('[Mosaic] failed to open', error);
    if (host === ownHost) closeMosaic(); // never leave the page scroll-locked without a way back
  }
}

function closeMosaic() {
  unmount?.();
  unmount = null;
  host?.remove();
  host = null;
  openPullRequest = null;
  document.documentElement.style.overflow = savedOverflow;
  parkGitHub(false);
  updatePill();
}

const toggle = () => (host ? closeMosaic() : void openMosaic());

// ---- launcher pill ----
// The pill lives on every pull request page in its own tiny shadow root, so it carries its few
// styles inline instead of loading the UI's stylesheet.
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const PILL_STYLES = `button{position:fixed;right:18px;bottom:18px;z-index:2147483645;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    color:#fff;background:#2f81f7;border:0;border-radius:99px;padding:8px 14px;box-shadow:0 6px 20px #0006;cursor:pointer;display:flex;align-items:center;gap:7px}
    svg{width:14px;height:14px;fill:currentColor}button:hover{background:#1f6feb}`;

let pill: HTMLElement | null = null;
function updatePill() {
  const shouldShow = !!pullRequestFromPath(location.pathname) && !host;
  if (!shouldShow) {
    pill?.remove();
    pill = null;
    return;
  }
  if (pill?.isConnected) return;
  pill = document.createElement('div');
  pill.id = 'mosaic-launcher';
  const shadow = pill.attachShadow({ mode: 'open' });
  const button = document.createElement('button');
  const logo = document.createElementNS(SVG_NAMESPACE, 'svg');
  logo.setAttribute('viewBox', '0 0 16 16');
  for (const tile of LOGO_TILES) {
    const rectangle = document.createElementNS(SVG_NAMESPACE, 'rect');
    const attributes = { x: tile.left, y: tile.top, width: tile.width, height: tile.height, rx: 1.5 };
    for (const [name, value] of Object.entries(attributes)) rectangle.setAttribute(name, String(value));
    logo.append(rectangle);
  }
  button.append(logo, 'Mosaic');
  button.title = 'Review this PR in Mosaic (Alt+Shift+M)';
  const style = document.createElement('style');
  style.textContent = PILL_STYLES;
  button.addEventListener('click', () => void openMosaic());
  shadow.append(style, button);
  document.documentElement.append(pill);
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (toggleMessageSchema.safeParse(message).success) toggle();
});

// ---- GitHub navigates without page loads: watch the URL ----
let lastHref = '';
setInterval(() => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  const reference = pullRequestFromPath(location.pathname);
  if (openPullRequest && (!reference || pullRequestId(reference) !== openPullRequest)) closeMosaic();
  updatePill();
  syncNativeTimer();
}, 400);

// ---- measure the user's pace in GitHub's own files view (for "time saved") ----
const store = chromeStore;
let nativePullRequest: PullRequestReference | null = null;
let nativeSeconds = 0;
const timer = new ActiveTimer({ now: () => Date.now(), visible: () => document.visibilityState === 'visible' }, () => {
  if (nativePullRequest && !host) nativeSeconds++;
});
for (const eventName of ['keydown', 'mousemove', 'mousedown', 'wheel', 'scroll'])
  window.addEventListener(eventName, () => timer.poke(), { passive: true, capture: true });

function syncNativeTimer() {
  const reference = pullRequestFromPath(location.pathname);
  const onFilesView = reference && /\/pull\/\d+\/(changes|files)/.test(location.pathname) ? reference : null;
  if (nativePullRequest && (!onFilesView || pullRequestId(nativePullRequest) !== pullRequestId(onFilesView)))
    void flushNativeTime();
  nativePullRequest = onFilesView;
  if (nativePullRequest) timer.start();
  else timer.stop();
}

async function flushNativeTime() {
  if (!nativePullRequest || nativeSeconds === 0) return;
  const seconds = nativeSeconds;
  nativeSeconds = 0;
  await updateRecord(store, recordKey(nativePullRequest), record => {
    record.githubSeconds += seconds;
  });
}
setInterval(() => void flushNativeTime(), 15_000);
addEventListener('pagehide', () => void flushNativeTime());

const weightsByPullRequest = new Map<string, Map<string, number>>();
async function weightsFor(reference: PullRequestReference): Promise<Map<string, number>> {
  const id = pullRequestId(reference);
  const known = weightsByPullRequest.get(id);
  if (known) return known;
  let html = [...document.querySelectorAll('script[data-target*="embeddedData"]')]
    .map(script => script.outerHTML)
    .join('');
  if (!embeddedPayloads(html).some(payload => JSON.stringify(payload).includes('pullRequestsChangesRoute'))) {
    const response = await fetch(`/${reference.owner}/${reference.repository}/pull/${reference.number}/changes`, {
      headers: { Accept: 'text/html' },
    });
    html = await response.text();
  }
  const weights = new Map(
    parseChangesRoute(html).summaries.map(summary => [
      summary.path,
      Math.max(1, summary.additions + summary.deletions),
    ]),
  );
  weightsByPullRequest.set(id, weights);
  return weights;
}

window.addEventListener('message', async event => {
  if (event.source !== window) return;
  const message = fileReviewMessageSchema.safeParse(event.data);
  if (!message.success) return;
  const { path, viewed } = message.data;
  const reference = pullRequestFromPath(location.pathname);
  if (!reference || host) return;
  try {
    const weights = await weightsFor(reference);
    await updateRecord(store, recordKey(reference), record => {
      const paths = new Set(record.githubPaths ?? []);
      if (viewed) paths.add(path);
      else paths.delete(path);
      record.githubPaths = [...paths];
      record.githubLines = record.githubPaths.reduce((sum, viewedPath) => sum + (weights.get(viewedPath) ?? 1), 0);
    });
  } catch {
    /* measurement is best-effort */
  }
});

updatePill();
syncNativeTimer();
