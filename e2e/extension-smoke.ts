// Loads dist/ as an unpacked extension in a throwaway profile (logged out) and checks the wiring:
// launcher pill on a PR page, overlay mounts via dynamic import, background relay answers.
import { chromium } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executablePath =
  process.env.CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const extensionPath = resolve('dist');
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mosaic-')), {
  executablePath,
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const serviceWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
check('background service worker running', !!serviceWorker, serviceWorker?.url());
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto('https://github.com/oven-sh/bun/pull/44361', { waitUntil: 'domcontentloaded' });
const pill = page.locator('#mosaic-launcher button');
await pill.waitFor({ timeout: 15000 });
check('launcher pill shown on PR page', await pill.isVisible());
await pill.click();
await page.locator('#mosaic-review-root .mosaic').waitFor({ timeout: 15000 });
await page.locator('[data-slot="empty-state"] h2', { hasText: 'Log in' }).waitFor({ timeout: 20000 });
check(
  'overlay mounts and explains the logged-out state',
  true,
  await page.locator('[data-slot="empty-state"] h2').innerText(),
);
await page.screenshot({ path: '/tmp/mosaic-smoke.png' });
await page.keyboard.press('Escape');
check('esc closes overlay', (await page.locator('#mosaic-review-root').count()) === 0);
check('pill returns after closing', await pill.isVisible());
// Background relay: the raw .diff of a public PR through the service worker.
const relay = await page
  .evaluate(() => new Promise(resolveSoon => setTimeout(resolveSoon, 10)))
  .then(() =>
    serviceWorker.evaluate(async () => {
      const response = await fetch('https://github.com/oven-sh/bun/pull/44361.diff', { credentials: 'include' });
      return {
        status: response.status,
        host: new URL(response.url).host,
        diff: (await response.text()).startsWith('diff --git'),
      };
    }),
  );
check(
  'service worker can fetch a PR .diff (redirect followed)',
  relay.status === 200 && relay.diff,
  JSON.stringify(relay),
);
check('no page errors from Mosaic', !errors.some(message => /mosaic|ui\.js/i.test(message)), errors.join(' | '));
await context.close();
console.log(failures ? `${failures} failed` : 'smoke passed');
process.exit(failures ? 1 : 0);
