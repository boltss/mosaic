// Live discovery against a real PR in the logged-in test browser (CDP on :9222).
// Prints the shapes Mosaic's parsers rely on — no code contents.
//   bun e2e/live-discover.ts <owner>/<repository>/pull/<number>
import { chromium } from 'playwright-core';

const target = process.argv[2];
if (!target) throw new Error('usage: pass a pull request as <owner>/<repository>/pull/<number>');
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0]!;
const page = await context.newPage();
await page.goto(`https://github.com/${target}/changes`, { waitUntil: 'domcontentloaded' });
const report = await page.evaluate(async pullRequestPath => {
  const shape = (value: unknown, depth = 3): unknown =>
    Array.isArray(value)
      ? [`len ${value.length}`, value.length && depth ? shape(value[0], depth - 1) : '…']
      : value && typeof value === 'object'
        ? depth
          ? Object.fromEntries(
              Object.entries(value)
                .slice(0, 40)
                .map(([key, child]) => [key, shape(child, depth - 1)]),
            )
          : '{…}'
        : typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
          ? 'oid'
          : typeof value === 'boolean' || value == null
            ? value
            : typeof value;
  const html = await (await fetch(`/${pullRequestPath}/changes`, { headers: { Accept: 'text/html' } })).text();
  const parsedPage = new DOMParser().parseFromString(html, 'text/html');
  let route: Record<string, unknown> | null = null;
  for (const script of parsedPage.querySelectorAll('script[data-pr*="embeddedData"]')) {
    try {
      const embedded = JSON.parse(script.textContent!);
      if (embedded?.payload?.pullRequestsChangesRoute) route = embedded.payload.pullRequestsChangesRoute;
    } catch {}
  }
  if (!route)
    return {
      error: 'no route',
      userLogin: parsedPage.querySelector('meta[name="user-login"]')?.getAttribute('content'),
    };
  const summaries = route.diffSummaries as { path: string }[];
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="fetch-nonce"]')?.content ?? '';
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'GitHub-Is-React': 'true',
    'GitHub-Verified-Fetch': 'true',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Fetch-Nonce': nonce,
  };
  const diffEntriesQuery = (range: string | null) => {
    const query = new URLSearchParams();
    query.set(
      'paths',
      summaries
        .slice(0, 5)
        .map(summary => encodeURIComponent(summary.path))
        .join(','),
    );
    query.set('ctx', ':::');
    query.set('w', '0');
    if (range) query.set('range', range);
    return query.toString();
  };
  const withoutRange = await fetch(`/${pullRequestPath}/page_data/diff_entries?${diffEntriesQuery(null)}`, {
    headers,
  });
  const entries = withoutRange.ok ? await withoutRange.json() : null;
  const lineTypes = new Set<string>(),
    markers: Record<string, string> = {};
  for (const entry of entries ?? [])
    for (const line of entry.diffLines ?? []) {
      lineTypes.add(line.type);
      markers[line.type] ??= JSON.stringify((line.text as string).slice(0, 1));
    }
  const htmlSample = entries?.[0]?.diffLines
    ?.find((line: { html?: string }) => line.html)
    ?.html?.replace(/>[^<]+</g, '>…<')
    .slice(0, 200);
  return {
    routeKeys: Object.keys(route),
    comparison: shape(route.comparison),
    pullRequest: shape(route.pullRequest, 1),
    commit: shape(route.commit, 1),
    urls: shape(route.urls, 1),
    pageLimits: route.pageLimits,
    summaries: summaries.length,
    diffEntriesWithoutRange: withoutRange.status,
    lineTypes: [...lineTypes],
    firstCharByType: markers,
    htmlSample,
    entryOids: entries?.[0] ? { old: shape(entries[0].oldCommitOid), new: shape(entries[0].newCommitOid) } : null,
  };
}, target);
console.log(JSON.stringify(report, null, 1));
await page.close();
process.exit(0);
