// End-to-end checks of the full UI against the fixture PR (no GitHub needed).
//   bun run build && (bun run dev/serve.ts &) && bun e2e/harness.e2e.ts
import { chromium, type Page } from 'playwright-core';

const BASE = process.env.HARNESS ?? 'http://localhost:5173/harness.html';
const executablePath =
  process.env.CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SHOTS = process.env.SHOTS ?? '/tmp';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const viewedLog = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __mosaic: { source: { viewedLog: string[] } } }).__mosaic.source.viewedLog.slice(),
  );
const progress = (page: Page) => page.locator('[data-slot="progress-summary"]').innerText();
const tile = (page: Page, path: string) => page.locator(`[data-slot="tile"][data-path="${path}"]`);

const browser = await chromium.launch({ executablePath, headless: true });
const errors: string[] = [];
async function open(query = '', viewport = { width: 1440, height: 900 }, waitLoaded = true) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  await page.goto(`${BASE}?latency=40${query}`);
  await page.locator('[data-slot="tile"]').first().waitFor();
  if (!waitLoaded) return page;
  await page.waitForFunction(
    () =>
      !document
        .querySelector('#host')
        ?.shadowRoot?.querySelector('[data-slot="progress-summary"]')
        ?.textContent?.includes('loading'),
    null,
    { timeout: 15000 },
  );
  return page;
}

// ---- load + layout ----
let page = await open();
check('all 101 files render as tiles', (await page.locator('[data-slot="tile"]').count()) === 101);
check('no skeletons left after load', (await page.locator('[data-slot="tile"] [data-slot="skeleton"]').count()) === 0);
check(
  'truncated small file completed from raw diff',
  ((await tile(page, 'apps/web/src/api/client.ts').textContent()) ?? '').includes('credentials'),
);
const big = tile(page, 'apps/mobile/src/data/seed-exercises.ts');
check('large review file is locked', await big.locator('input[type=checkbox]').isDisabled());
check(
  'wide tile spans the row',
  (await tile(page, 'apps/mobile/src/screens/Settings/ThemeSettingsSection.tsx').getAttribute('data-wide')) != null,
);
check('long context folds', (await page.locator('[data-slot="fold"]').count()) > 0);
check(
  'buckets: generated 25, same edit present',
  (await page.locator('[data-slot="bucket"]', { hasText: 'Generated' }).innerText()).includes('25/25') &&
    (await page.locator('[data-slot="bucket"]', { hasText: 'Same edit' }).count()) === 1,
);
check(
  'same edit +N tag on a file with extra changes',
  (await tile(page, 'apps/mobile/src/screens/Settings/SettingsScreen.tsx').innerText()).includes('same edit +1'),
);
check(
  'python indentation change stays in review',
  !(await tile(page, 'apps/mobile/src/utils/indent.py').innerText()).includes('whitespace'),
);
await page.screenshot({ path: `${SHOTS}/mosaic-1-loaded.png` });

// ---- markdown ----
const agents = tile(page, 'AGENTS.md');
const agentsText = await agents.innerText();
check(
  'markdown preview renders with word diff',
  agentsText.includes('Estonian translation') && (await agents.locator('ins').count()) > 0,
);
check(
  'hidden link change flagged',
  agentsText.includes('hidden change: link target changed: docs/style.md → docs/STYLE.md'),
);
check('hidden comment change flagged', agentsText.includes('HTML comment changed'));
check(
  'removed section shown as removed',
  (await agents.locator('[data-slot="markdown-block"][data-change="removed"]').count()) > 0,
);
check(
  'front matter table on new file',
  (await tile(page, '.claude/skills/localization/SKILL.md').locator('[data-slot="front-matter"]').count()) === 1,
);
check(
  'relative image resolved to PR head raw URL',
  ((await tile(page, '.claude/skills/localization/SKILL.md').locator('img').getAttribute('src')) ?? '').includes(
    '/raw/ffff',
  ),
);
await agents.locator('[data-slot="tile-header"]').click();
await page.keyboard.press('p');
check(
  'p toggles markdown to code view',
  (await agents.locator('[data-slot="code"]').count()) === 1 &&
    (await agents.locator('[data-slot="markdown"]').count()) === 0,
);
await page.keyboard.press('p');

// ---- keyboard viewed flow ----
const before = (await viewedLog(page)).length;
const firstFocus = await page.locator('[data-slot="tile"][data-focused]').getAttribute('data-path');
await page.keyboard.press('x');
await page.waitForTimeout(600);
const log1 = await viewedLog(page);
check(
  'x marks focused file viewed on the source',
  log1.length === before + 1 && log1.at(-1) === `+${firstFocus}`,
  log1.at(-1),
);
const nextFocus = await page.locator('[data-slot="tile"][data-focused]').getAttribute('data-path');
check('x jumps to the next unviewed file', !!nextFocus && nextFocus !== firstFocus, `${firstFocus} → ${nextFocus}`);
await page.keyboard.press('j');
check(
  'j moves focus',
  (await page.locator('[data-slot="tile"][data-focused]').getAttribute('data-path')) !== nextFocus,
);

// ---- bulk + undo ----
const progressBefore = await progress(page);
await page.locator('[data-slot="bucket"]', { hasText: 'Generated' }).locator('[data-slot="bucket-toggle-all"]').click();
await page.waitForTimeout(1200);
check(
  'bucket ✓ all marks 25 files',
  (await viewedLog(page)).filter(entry => entry.startsWith('+packages/api-client')).length === 25,
);
check('progress moved', (await progress(page)) !== progressBefore, `${progressBefore} → ${await progress(page)}`);
const undo = page.locator('[data-slot="toast"] button', { hasText: 'Undo' });
check('undo toast shown', await undo.isVisible());
await page.screenshot({ path: `${SHOTS}/mosaic-2-bulk.png` });
await undo.click();
await page.waitForTimeout(1200);
check(
  'undo reverts on the source',
  (await viewedLog(page)).filter(entry => entry.startsWith('-packages/api-client')).length === 25,
);
check(
  'generated bucket unviewed again',
  (await page.locator('[data-slot="bucket"]', { hasText: 'Generated' }).innerText()).includes('25/25'),
);

// ---- folder checkbox ----
await page
  .locator('[data-slot="section"][data-directory="apps/mobile/src/locales"] [data-slot="section-header"] input')
  .click();
await page.waitForTimeout(800);
check(
  'folder checkbox marks the remaining locale files',
  (await page
    .locator('[data-slot="section"][data-directory="apps/mobile/src/locales"] [data-slot="tile"][data-viewed]')
    .count()) === 6,
);

// ---- large file unlock via panel ----
await big.locator('[data-slot="tile-header"]').click();
await page.keyboard.press('Enter');
await page.locator('[data-slot="panel"]').waitFor();
check('panel opens with full diff', (await page.locator('[data-slot="panel"] tr[data-kind="addition"]').count()) > 200);
await page.locator('[data-slot="panel-body"]').evaluate(element => element.scrollTo(0, element.scrollHeight));
await page.waitForTimeout(300);
check(
  'scrolling to the end unlocks Viewed',
  !(await page.locator('[data-slot="panel"] input[type=checkbox]').isDisabled()),
);
await page.screenshot({ path: `${SHOTS}/mosaic-3-panel.png` });
await page.keyboard.press('Escape');
check(
  'esc closes the panel first',
  (await page.locator('[data-slot="panel"]').count()) === 0 && (await page.locator('.mosaic').count()) === 1,
);

// ---- same edit banner ----
await page.locator('[data-slot="bucket"]', { hasText: 'Same edit' }).click();
check(
  'same edit banner explains the group',
  (await page.locator('[data-slot="same-edit-banner"]').first().innerText()).includes('exactly this edit'),
);
await page.screenshot({ path: `${SHOTS}/mosaic-4-same-edit.png` });
await page.locator('[data-slot="bucket"]', { hasText: 'All files' }).click();

// ---- filter / hide viewed ----
await page.keyboard.press('/');
await page.keyboard.type('Dashboard');
check('filter narrows tiles', (await page.locator('[data-slot="tile"]').count()) === 3);
await page.keyboard.press('Escape');
await page.locator('input[type=search]').fill('');
await page.keyboard.press('Escape');
await page.keyboard.press('v');
check('hide viewed hides viewed tiles', (await page.locator('[data-slot="tile"][data-viewed]').count()) === 0);
await page.keyboard.press('v');

// ---- time summary ----
await page.keyboard.press('t');
const card = await page.locator('[data-slot="dialog"]').innerText();
check(
  'time summary shows active time and baseline',
  card.includes('active time in Mosaic') && card.includes('min per 100 changed lines'),
);
await page.screenshot({ path: `${SHOTS}/mosaic-5-summary.png` });
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
check(
  'esc closes Mosaic',
  (await page.locator('.mosaic').count()) === 0 && (await page.locator('#reopen').isVisible()),
);
await page.close();

// ---- failure rollback ----
page = await open('&fail=1');
const dash = tile(page, 'apps/mobile/src/screens/Dashboard/useDashboardData.ts');
await dash.locator('input[type=checkbox]').click();
await page.locator('[data-slot="toast"][data-variant="error"]').waitFor({ timeout: 5000 });
check(
  'rejected save shows an error with retry',
  (await page.locator('[data-slot="toast"][data-variant="error"]').innerText()).includes('Retry'),
);
check('rejected save rolls the checkbox back', !(await dash.locator('input[type=checkbox]').isChecked()));
await page.close();

// ---- nothing can be marked viewed before its diff is shown ----
page = await open('&latency=1500', undefined, false);
check(
  'checkbox disabled while a diff is loading',
  await tile(page, 'apps/mobile/src/locales/fi.json').locator('input[type=checkbox]').isDisabled(),
);
await page
  .locator('[data-slot="bucket"]', { hasText: 'Translations' })
  .locator('[data-slot="bucket-toggle-all"]')
  .click();
await page.locator('[data-slot="toast"]', { hasText: 'skipped' }).waitFor({ timeout: 15000 });
check(
  'bulk approve skips files still loading',
  (await viewedLog(page)).length === 0,
  (await page.locator('[data-slot="toast"]').first().innerText()).replace(/\s+/g, ' '),
);
await page.close();

// ---- focus follows filters ----
page = await open();
await page.keyboard.press('/');
await page.keyboard.type('Journal');
await page.keyboard.press('Escape');
await page.keyboard.press('x');
await page.waitForTimeout(600);
check(
  'x acts on a visible file after filtering',
  ((await viewedLog(page)).at(-1) ?? '').includes('Journal'),
  (await viewedLog(page)).at(-1),
);
await page.close();

// ---- ticking a folder from its sticky header scrolls back to it ----
page = await open();
const pinned = await page.evaluate(() => {
  const main = document.querySelector('#host')!.shadowRoot!.querySelector('[data-slot="main"]') as HTMLElement;
  const tallSection = ([...main.querySelectorAll('[data-slot="section"]')] as HTMLElement[]).find(
    section => section.offsetHeight > 900,
  )!;
  main.scrollTop = tallSection.offsetTop + tallSection.offsetHeight - 500;
  return tallSection.getAttribute('data-directory')!;
});
await page.locator(`[data-slot="section"][data-directory="${pinned}"] [data-slot="section-header"] input`).click();
await page.waitForTimeout(500);
const [sectionTop, nextTop] = await page.evaluate(directory => {
  const main = document.querySelector('#host')!.shadowRoot!.querySelector('[data-slot="main"]') as HTMLElement;
  const section = main.querySelector(`[data-slot="section"][data-directory="${directory}"]`)!;
  const topOf = (element: Element) =>
    Math.round(element.getBoundingClientRect().top - main.getBoundingClientRect().top);
  return [topOf(section), topOf(section.nextElementSibling!)];
}, pinned);
check(
  'ticked folder closes at the top with the next folder in view',
  sectionTop === 0 && nextTop > 0 && nextTop < 600,
  `folder at ${sectionTop}px, next at ${nextTop}px`,
);
await page.close();

// ---- image files show the picture ----
page = await open();
const icon = tile(page, 'apps/mobile/assets/icon.png');
await icon.scrollIntoViewIfNeeded();
await icon.locator('[data-slot="image-side"][data-side="new"] img').waitFor();
const shown = await icon
  .locator('img')
  .evaluateAll(images => images.map(image => (image as HTMLImageElement).naturalWidth));
check(
  'changed image shows before and after',
  shown.length === 2 && shown.every(width => width === 96),
  `widths ${shown.join(', ')}`,
);
check('image tile has no "Binary file" text', !((await icon.textContent()) ?? '').includes('Binary file'));
check(
  'added image shows one picture',
  (await tile(page, 'apps/mobile/assets/splash.png').locator('img').count()) === 1,
);
await icon.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/mosaic-images.png` });
await page.close();

// ---- test outline + collapsed lockfile ----
page = await open();
const spec = tile(page, 'apps/mobile/src/utils/__tests__/format.test.ts');
check(
  'test file lists its test names',
  (await spec.locator('[data-slot="outline-row"][data-kind="test"] [data-slot="outline-name"]').allTextContents()).join(
    '|',
  ) ===
    'trims surrounding whitespace|keeps inner spaces|returns an empty string for null|formats goal scores out of ten',
  (await spec.locator('[data-slot="outline-row"] [data-slot="outline-name"]').allTextContents()).join('|'),
);
check(
  'test bodies start hidden',
  (await spec.locator('[data-slot="line"]', { hasText: 'expect(format' }).count()) === 0,
);
await spec.locator('[data-slot="outline-row"][data-kind="test"]').nth(1).click();
check(
  'clicking a test name shows its code',
  (await spec.locator('[data-slot="line"]', { hasText: 'expect(format' }).count()) === 1,
);
await spec.locator('[data-slot="toggle-group"] button', { hasText: 'Code' }).click();
check(
  'code view shows the whole test file',
  (await spec.locator('[data-slot="line"]').count()) === 19 &&
    (await spec.locator('[data-slot="outline-row"]').count()) === 0,
  `${await spec.locator('[data-slot="line"]').count()} lines`,
);
const lock = tile(page, 'bun.lock');
check(
  'lockfile contents are hidden',
  (await lock.locator('[data-slot="line"]').count()) === 0 &&
    ((await lock.locator('[data-slot="alert"]').textContent()) ?? '').includes('Lockfile'),
);
check('lockfile can still be ticked', !(await lock.locator('input[type=checkbox]').isDisabled()));
await page.close();

// ---- light theme + narrow window ----
page = await open('&theme=light', { width: 1100, height: 800 });
await page.screenshot({ path: `${SHOTS}/mosaic-6-light.png` });
check('light theme applied', (await page.locator('.mosaic').getAttribute('data-theme')) === 'light');
await page.close();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
