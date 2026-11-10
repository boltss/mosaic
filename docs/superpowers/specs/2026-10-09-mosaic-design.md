# Mosaic — fast review of huge GitHub pull requests

Date: 2026-10-09 · Status: approved in conversation, implementation authorised

## 1. Problem and goal

Reviewing a 200+ file PR in GitHub's "Files changed" view takes about an hour, mostly
spent on waiting for lazy-loaded diffs, scrolling file by file, clicking "Viewed" per
file and deciding whether boring files (lockfiles, generated code, snapshots) matter.

Mosaic is a Chrome extension that opens a full-screen tiled review view on top of any
GitHub PR. It loads every file at once, sorts low-risk files into bulk-approvable
buckets, keeps GitHub's own "Viewed" state in sync, and measures how much time it saves.

Success criteria:

- a real 206-file pull request (+20.8k/−4.8k) opens with all tiles populated in a few seconds.
- No changed line is ever hidden without an explicit, visible affordance.
- Viewed state round-trips to GitHub (visible in GitHub's own UI after reload).
- The user can see measured time saved per PR against their own GitHub-native pace.

Non-goals (v1): inline commenting (tiles link to GitHub for that), Firefox/Safari,
Chrome Web Store publishing, server components of any kind.

## 2. Hard constraints

- **Never hide a changed line silently.** Tiles grow to fit all changed lines; long
  lines wrap; only runs of unchanged context fold, with an explicit "⋯ N unchanged lines"
  row. Files GitHub truncates are completed from the raw `.diff`. Huge files (> 300
  changed lines) in "Needs review" render collapsed and their Viewed checkbox stays
  locked until the user has scrolled the diff panel to the end.
- **No tokens, no app, no secrets.** All data comes from github.com using the user's
  existing browser session (see §5). The code must be safe to open-source.
- **Bucket rules err on the side of "Needs review".**
- Tooling: Bun only (no Node/npm), `mise.toml` pins Bun, TypeScript strict.

## 3. User experience

Reference mockups: `docs/mockups/review-view.html`, `docs/mockups/md-preview.html`.

- **Launch:** on `github.com/<owner>/<repo>/pull/<n>*` a floating "▦ Mosaic" pill
  appears bottom-right; the keyboard command `Alt+Shift+M` (configurable in
  `chrome://extensions/shortcuts`) toggles the view. The view is a full-viewport overlay
  in a shadow root; `Esc` with nothing else open closes it. The URL does not change.
- **Top bar:** PR title, line-weighted progress bar ("X% of changed lines · a/b files ·
  N need real review"), time chip (active time + "~N min saved"), file filter (`/`),
  tile size S/M/L (`1`/`2`/`3`), "Hide viewed" (`v`), link to GitHub's view.
- **Sidebar:** "All files"; Triage buckets with remaining/total counts and "✓ all"
  buttons; folder tree (single-child chains compressed) with tri-state checkbox, mini
  progress bar and file count. Clicking a bucket filters; clicking a folder scrolls.
- **Main area:** one section per directory with sticky header (folder checkbox, path,
  viewed count, +/−). Tiles are packed (masonry) and show every changed line with two
  lines of context; files with > 40 changed lines span the full row; viewed tiles
  collapse to their header and dim.
- **Tile header:** viewed checkbox, status letter (A/M/D/R), file name, bucket pill
  with reason tooltip, +/− counts, Preview/Code toggle for markdown.
- **Diff panel:** `Enter` or click opens the full diff of the focused file in a right-hand
  panel with line numbers, Viewed toggle and "Comment on GitHub ↗".
- **Keyboard:** `j`/`k` next/prev file, `x` toggle viewed and jump to next unviewed,
  `X` toggle whole folder, `Enter` open panel, `Esc` close, `p` preview/code toggle,
  `t` time summary, `/` filter, `1`/`2`/`3` size, `v` hide viewed.
- **Bulk approve:** "✓ all" labels its scope ("✓ 50 files · 412 lines"). After any bulk
  action an Undo toast stays 10 s and reverts on GitHub too.

## 4. Review rules (classification)

Each file gets exactly one bucket; first match wins; every bucket carries a reason.

| #   | Bucket               | Rule                                                                                                                                                                                                                                           |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Renamed, no edits    | changeType RENAMED and 0 changed lines                                                                                                                                                                                                         |
| 2   | Deleted              | changeType DELETED (tile still shows removed lines)                                                                                                                                                                                            |
| 3   | Lockfiles            | basename in: bun.lock, bun.lockb, package-lock.json, npm-shrinkwrap.json, yarn.lock, pnpm-lock.yaml, Podfile.lock, Gemfile.lock, Cargo.lock, go.sum, poetry.lock, uv.lock, composer.lock, flake.lock, Package.resolved, pubspec.lock, mix.lock |
| 4   | Generated / vendored | GitHub `isGenerated` (linguist, honours `.gitattributes`) or `isVendored`, or a visible header line containing `@generated`, `DO NOT EDIT` or `Code generated by`                                                                              |
| 5   | Snapshots            | `*.snap` or path segment `__snapshots__`                                                                                                                                                                                                       |
| 6   | Translations         | extension json/yml/yaml/po/pot/strings/stringsdict/xliff/xlf/arb/properties AND a path segment in locales/locale/i18n/l10n/translations/lang/langs/messages                                                                                    |
| 7   | Whitespace only      | multiset of removed lines equals multiset of added lines after removing all whitespace; never for indentation-significant files (py, pyi, yml, yaml, Makefile, mk, sass, styl, pug, jade, haml, slim, coffee, nim, fs, fsx, hs, elm)           |
| 8   | Same edit (v2)       | see §8                                                                                                                                                                                                                                         |
| —   | Needs review         | everything else                                                                                                                                                                                                                                |

Settings allow switching each low-risk bucket off (its files fall back to Needs review).
The rule engine takes a rule list so per-repo custom rules can be added later.

## 5. GitHub access (session adapter)

Verified with a throwaway probe on a real 206-file pull request (Chrome 153). All of it lives in
`src/github/` — the only code that knows GitHub internals. Every response is
shape-validated; on mismatch Mosaic shows "GitHub changed something — open GitHub's
view" instead of rendering wrong data.

- **File list + viewed state:** fetch `/<o>/<r>/pull/<n>/changes` HTML (same-origin,
  cookies), parse `script[data-target*="embeddedData"]` JSON →
  `payload.pullRequestsChangesRoute.diffSummaries[]` (`path, changeType, linesAdded,
  linesDeleted, linesChanged, markedAsViewed, isVendored, isManifestFile, pathDigest`).
  The commit range / head OID for diff requests is taken from this payload.
- **Highlighted diffs:** `GET /<o>/<r>/pull/<n>/page_data/diff_entries?paths=<encoded
  list>&ctx=:::&w=0&range=<oid>` with headers `Accept: application/json`,
  `GitHub-Verified-Fetch: true`, `X-Requested-With: XMLHttpRequest`, `X-Fetch-Nonce`
  (from `<meta name="fetch-nonce">`). Batches are bounded by URL length (≤ 6000 chars of
  query); 3 batches in flight. Per file: `diffLines[{type,text,html,left,right}]`,
  `isTooBig`, `truncatedReason`, `newTreeEntry.isGenerated`.
- **Raw full diff:** `GET /<o>/<r>/pull/<n>.diff` from the **background service worker**
  (content-script fetch fails CORS on the redirect to patch-diff.githubusercontent.com).
  Parsed into per-file hunks; used for files whose `diff_entries` result is too big,
  truncated or missing, and as a completeness check (file count).
- **Viewed:** `POST /<o>/<r>/pull/<n>/file_review` `{path, viewed:"viewed"}`; unmark
  `DELETE` same URL `{path, _method:"delete"}`; ≤ 6 in flight; optimistic UI with
  rollback on failure.
- **Whole files (markdown preview):** old/new content via
  `https://github.com/<o>/<r>/raw/<oid>/<path>` fetched through the background worker
  (redirects to raw.githubusercontent.com).

Highlighted HTML from GitHub is passed through DOMPurify allowing only `span[class]`.

## 6. Architecture

```
src/
  manifest.json            MV3; host perms github.com, patch-diff.githubusercontent.com,
                           raw.githubusercontent.com; storage; commands
  background/              service worker: .diff + raw fetch proxy, command relay
  content/                 pill + overlay mount (shadow root), GitHub-view activity timer
  github/                  session adapter (§5), pure parsers + fetchers
  review/                  pure logic: classify, segments (context folding), progress,
                           tree, sameEdit (v2)
  markdown/                block split (markdown-it line maps), block diff, word diff,
                           hidden-change detection, sanitised render
  metrics/                 active-time tracker, per-PR records, baseline pace
  ui/                      React 19 + TanStack Query; CSS injected into the shadow root
dev/harness.*              mounts the UI with a fixture adapter (no GitHub needed)
```

- UI depends on an `ReviewSource` interface (listFiles, loadDiffs, setViewed,
  loadFileContents) — the GitHub adapter implements it; the harness uses fixtures.
- TanStack Query: one query for the file list, one per diff batch, raw-diff query,
  per-file content queries; viewed changes are mutations with optimistic update and
  rollback.
- Rendering: tiles use `content-visibility: auto` with remembered intrinsic size;
  masonry rows computed from a ResizeObserver per tile.
- Build: `build.ts` uses `Bun.build` for background, content and harness entries and
  copies the manifest into `dist/`. Load `dist/` unpacked.

## 7. Time measurement

- Active time accrues only while the tab is visible and there was input (key, mouse,
  wheel, scroll) within the last 60 s.
- In Mosaic: per PR, store active seconds, files/lines viewed in Mosaic, lines bulk
  cleared.
- In GitHub's own view (`/pull/<n>/changes` or `/files` while Mosaic is closed): store
  active seconds, and the changed lines of every file the user marks viewed there. A
  tiny main-world script observes GitHub's own `POST file_review` requests (path only)
  and the content script looks the line counts up in the page's embedded summaries.
- Baseline pace = GitHub minutes per 100 changed lines, from PRs with ≥ 5 active minutes
  in GitHub's view. Until 3 such PRs exist, the UI shows measured time only and says
  "baseline not ready".
- Saved = lines viewed in Mosaic × baseline pace − Mosaic active time. Weekly totals in
  the summary card (`t`). Everything in `chrome.storage.local`.

## 8. Follow-ups (in order)

1. **Markdown preview** (`.md`, `.mdx`, `.markdown`): Preview default with Code toggle;
   block diff (added green, removed red strikethrough in place, changed yellow with
   word-level `ins`/`del` for text blocks); hidden-change badges when source changed
   but rendered text did not (link/image targets, HTML comments, front matter, raw HTML
   attributes); front matter as a table; relative links/images resolved to the PR head;
   sanitised with DOMPurify.
2. **Same edit grouping:** per file, normalise each changed line (collapse whitespace,
   replace identifier tokens inside import specifier braces with a placeholder, replace
   `../` runs with a placeholder); a file's signature is its ordered list of normalised
   changed lines. Files whose signature appears in ≥ 3 files and has no other changes
   form a group; files containing a group's lines plus others are tagged
   "same edit +N" and stay in Needs review.
3. Per-repo custom rules, review-order suggestions.

## 9. Testing and verification

- `bun test`: classification, whitespace rule, context folding, progress, tree,
  unified-diff parser, diff_entries batching, embedded-JSON parser and validators
  (fixtures modelled on the verified shapes), markdown block/word diff and hidden-change
  detection, metrics maths.
- Harness: the full UI against a generated 200-file fixture, driven in Chromium for
  layout, keyboard, bulk/undo and markdown checks.
- Live: Playwright's Chromium with the unpacked extension and a persistent profile the
  user logs into once; run against a large real pull request — load every file, compare
  counts with GitHub, mark/unmark a file and confirm via reload, open markdown previews.
