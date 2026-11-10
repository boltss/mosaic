# Mosaic — review huge GitHub PRs fast

A Chrome extension that opens any GitHub pull request as a full-screen **mosaic of tiles**:
every file's diff at once, low-risk files sorted into buckets you can approve in bulk,
and GitHub's own "Viewed" checkboxes kept in sync.

- **Everything loads at once** — no lazy loading, no clicking file by file.
- **Code tiles show every changed line** — only unchanged context folds. Files GitHub
  truncates are completed from the raw `.diff`. Huge files must be scrolled to the end
  before they can be marked viewed.
- **Test files as a list of test names** — imports and setup, then one row per
  `describe`/test/hook with its line counts; click a row for its code, `p` for the whole
  file. Renamed tests show the old name; changes outside any named test stay open.
- **Images are shown** — PNG, JPEG, GIF, WebP, AVIF, BMP and ICO files render in the tile,
  before and after when they changed, with dimensions and file size.
- **Lockfiles are collapsed** to a one-line note with an Open button.
- **Sticky headers** — folder and file checkboxes follow the scroll, and ticking one
  scrolls back to where it closes.
- **Low-risk buckets** — renamed-only, deleted, lockfiles, generated/vendored (GitHub's own
  linguist flags), snapshots, translations, whitespace-only, and "same edit" groups
  (the same normalised change repeated across many files). Each has "✓ all" with undo.
- **Markdown preview** — `.md`/`.mdx` files render with added/changed/removed blocks,
  word-level highlights, and ⚠ badges for changes that don't show when rendered
  (link targets, HTML comments, reference links, front matter).
- **Viewed state syncs with GitHub** in both directions.
- **Time saved** — measures your active time in Mosaic against your own pace in
  GitHub's normal view (`t` opens the summary). Stored only in your browser.
- **No tokens, no app, no server** — it uses your existing GitHub session.

## Install

Download `mosaic.zip` from the [latest release](https://github.com/boltss/mosaic/releases/latest)
and unzip it somewhere permanent. Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick
the unzipped folder. To update, unzip the new release over the same folder and click ↻ on Mosaic's card.

Open any PR and click the **Mosaic** pill (bottom right) or press **Alt+Shift+M**.

### From source

```sh
mise install          # pins Bun (see mise.toml)
bun install
bun run build         # → dist/, then Load unpacked → dist/
```

## Checks

```sh
bun run check         # lint, format check, types and unit tests
bun run lint          # Oxlint (.oxlintrc.json), including the full-word naming rule
bun run format        # Oxc formatter (.oxfmtrc.json)
```

## Keys

| key         | action                               |
| ----------- | ------------------------------------ |
| `j` / `k`   | next / previous file                 |
| `x`         | toggle viewed, jump to next unviewed |
| `⇧X`        | toggle the whole folder              |
| `↵`         | open full diff panel                 |
| `p`         | markdown preview ↔ code              |
| `/`         | filter files                         |
| `1` `2` `3` | tile size                            |
| `v`         | hide viewed                          |
| `t`         | time summary                         |
| `esc`       | close panel / Mosaic                 |

## Develop

```sh
bun run dev           # rebuild dist/ on change (reload the extension in chrome://extensions)
bun test              # unit tests (parsers, review rules, markdown diff, metrics)
bun run harness       # full UI against a fake 98-file PR: http://localhost:5173/harness.html
bun run e2e           # drives the harness in headless Chromium (harness server must be running)
bun run typecheck
```

Layout: `src/github` is the only code that knows GitHub's internal endpoints; `src/review`
and `src/markdown` are pure logic; `src/ui` is React 19 + TanStack Query rendered in a
shadow root. Design:
[`docs/superpowers/specs/2026-10-09-mosaic-design.md`](docs/superpowers/specs/2026-10-09-mosaic-design.md).

**Schemas.** Every shape that crosses a boundary is a [Zod](https://zod.dev) schema with its
type inferred from it: GitHub's responses (`src/github/schemas.ts`), messages between the
page, content script and service worker (`src/shared/messages.ts`), stored records and
settings (`src/metrics/metrics.ts`, `src/ui/settings.ts`), and the shared review model
(`src/shared/types.ts`). Data is parsed where it enters, so a mismatch fails there and names
the field.

**Styling.** The UI is styled with Tailwind classes. `src/ui/styles.css` holds only the design
tokens (colours, sizes, radii — all in pixels, since the UI lives inside GitHub's page) and the
styles for HTML Mosaic doesn't write itself (rendered markdown, GitHub's syntax highlighting).
`build.ts` compiles it and hands it to the UI bundle as text for the shadow root. Reusable
building blocks live in `src/ui/components/` (`Button`, `Badge`, `Checkbox`, `Dialog`,
`ToggleGroup`, `Table`, `Toast`, …) in the shadcn style: variants via
`class-variance-authority`, classes merged with `classNames`, and a `data-slot` on each
component, which is also what the end-to-end tests select by.

**Naming.** Identifiers are full words, never abbreviations (`message`, not `msg`; `index`,
not `i`). `bun run lint` enforces it.

**Caveat:** Mosaic relies on undocumented github.com endpoints (the same ones GitHub's
own UI uses). If GitHub changes them, Mosaic shows "GitHub changed something" instead of
wrong data; fixes are confined to `src/github/`.

## Releasing

The version lives only in `package.json`; `build.ts` writes it into the manifest. Bump it, commit, then push a
matching tag:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/release.yml` checks the tag matches, runs `bun run check`, and attaches `mosaic.zip` (built by
`bun run package`, without source maps) to a GitHub release. The asset name never changes, so
`releases/latest/download/mosaic.zip` always points at the newest build. The install page in `site/` is published to
GitHub Pages by `.github/workflows/pages.yml`.

## License

[MIT](LICENSE) © 2026 Bolt Studios OÜ
