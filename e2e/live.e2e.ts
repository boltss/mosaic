// Live end-to-end check on a real PR in the logged-in test browser (Chrome for Testing with
// dist/ loaded, CDP on :9222). Marks one file viewed and restores it.
//   bun e2e/live.e2e.ts <owner>/<repository>/pull/<number>
import { chromium, type Page } from 'playwright-core';

const target = process.argv[2];
if (!target) throw new Error('usage: pass a pull request as <owner>/<repository>/pull/<number>');
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const serverViewed = (page: Page, path: string) =>
  page.evaluate(
    async ([pullRequestPath, filePath]) => {
      const html = await (await fetch(`/${pullRequestPath}/changes`, { headers: { Accept: 'text/html' } })).text();
      const parsedPage = new DOMParser().parseFromString(html, 'text/html');
      for (const script of parsedPage.querySelectorAll('script[data-target*="embeddedData"]')) {
        try {
          const route = JSON.parse(script.textContent!)?.payload?.pullRequestsChangesRoute;
          if (route)
            return (
              route.diffSummaries.find((summary: { path: string }) => summary.path === filePath)?.markedAsViewed ?? null
            );
        } catch {}
      }
      return null;
    },
    [target, path] as const,
  );

const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = await browser.contexts()[0]!.newPage();
await page.bringToFront(); // background windows never paint, so screenshots would hang
await page.setViewportSize({ width: 1600, height: 1000 });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(`https://github.com/${target}/changes`, { waitUntil: 'domcontentloaded' });
const expected = await page.evaluate(async pullRequestPath => {
  const html = await (await fetch(`/${pullRequestPath}/changes`, { headers: { Accept: 'text/html' } })).text();
  return /"diffSummaries":\[/.test(html) ? (html.match(/"markedAsViewed":/g) ?? []).length : -1;
}, target);

await page.locator('#mosaic-launcher button').click();
const t0 = Date.now();
await page.locator('[data-slot="tile"]').first().waitFor({ timeout: 30000 });
const firstTiles = Date.now() - t0;
await page.waitForFunction(
  () =>
    !document
      .querySelector('#mosaic-review-root')
      ?.shadowRoot?.querySelector('[data-slot="progress-summary"]')
      ?.textContent?.includes('loading'),
  null,
  { timeout: 90000 },
);
const allLoaded = Date.now() - t0;
const tiles = await page.locator('[data-slot="tile"]').count();
check('every file has a tile', tiles === expected, `${tiles} tiles, GitHub lists ${expected}`);
check(`tiles appear quickly`, firstTiles < 8000, `${firstTiles} ms`);
check(`all diffs loaded`, allLoaded < 60000, `${allLoaded} ms`);
// Markdown previews fetch file contents after the diffs, so give skeletons a moment to settle.
const settled = await page
  .locator('[data-slot="tile"] [data-slot="skeleton"]')
  .first()
  .waitFor({ state: 'detached', timeout: 20000 })
  .then(
    () => true,
    () => false,
  );
check(
  'no tile stuck loading or failed',
  settled &&
    (await page
      .locator('[data-slot="tile"] [data-slot="alert"][data-variant="warning"]', { hasText: "Couldn't load" })
      .count()) === 0,
);
const buckets = await page.locator('[data-slot="bucket"]').allInnerTexts();
console.log('buckets:', buckets.map(bucket => bucket.replace(/\s+/g, ' ')).join(' | '));
const markdownTiles = page.locator('[data-slot="tile"][data-path$=".md"]');
const markdownCount = await markdownTiles.count();
check(
  'markdown files render previews',
  markdownCount === 0 ||
    (await page.locator('[data-slot="tile"][data-path$=".md"] [data-slot="markdown"]').count()) > 0,
  `${markdownCount} markdown files`,
);
check(
  'no markdown preview failures',
  (await page
    .locator('[data-slot="tile"] [data-slot="alert"][data-variant="warning"]', { hasText: 'Preview unavailable' })
    .count()) === 0,
);
check(
  'syntax highlighting from GitHub is applied',
  (await page.locator('[data-slot="line"] span[class^="pl-"], [data-slot="line"] span[class*=" pl-"]').count()) > 0,
);
await page.screenshot({ path: '/tmp/mosaic-live-1.png' });

// Viewed round-trip on one unviewed, unlocked file in Needs review.
const candidate = page
  .locator('[data-slot="tile"]:not([data-viewed])')
  .filter({ has: page.locator('input[type=checkbox]:not([disabled])') })
  .first();
const path = (await candidate.getAttribute('data-path'))!;
const before = await serverViewed(page, path);
await candidate.locator('input[type=checkbox]').click();
await page.waitForTimeout(2500);
const after = await serverViewed(page, path);
check(
  'marking viewed in Mosaic persists on GitHub',
  before === false && after === true,
  `${path}: ${before} → ${after}`,
);
await page.locator(`[data-slot="tile"][data-path="${path}"] input[type=checkbox]`).click();
await page.waitForTimeout(2500);
check('unmarking restores GitHub state', (await serverViewed(page, path)) === false);

// Panel + markdown toggle sanity.
await page.locator(`[data-slot="tile"][data-path="${path}"] [data-slot="tile-header"]`).click();
await page.keyboard.press('Enter');
await page.locator('[data-slot="panel"] tr').first().waitFor();
check(
  'diff panel opens with numbered lines',
  (await page.locator('[data-slot="panel"] [data-slot="line-number"]').count()) > 0,
);
await page.screenshot({ path: '/tmp/mosaic-live-2.png' });
await page.keyboard.press('Escape');
await page.keyboard.press('t');
await page.locator('[data-slot="dialog"]').waitFor();
await page.screenshot({ path: '/tmp/mosaic-live-3.png' });
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
check('Mosaic closes', (await page.locator('#mosaic-review-root').count()) === 0);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.close();
console.log(failures ? `${failures} failed` : 'live checks passed');
process.exit(failures ? 1 : 0);
