// Builds the unpacked extension into dist/ (load it via chrome://extensions → Load unpacked).
//   bun run build.ts            one-off build
//   bun run build.ts --watch    rebuild on change
import type { BunPlugin } from 'bun';
import { watch } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';

const OUTPUT_DIRECTORY = 'dist';
const HARNESS_DIRECTORY = 'dist-dev';
const STYLES_ENTRY = 'src/ui/styles.css';
const COMPILED_STYLES = 'node_modules/.cache/mosaic/styles.css';

/**
 * Tailwind declares the defaults of its internal variables with `@property`, which browsers ignore
 * inside a shadow root — and Mosaic's whole UI lives in one. Without those defaults, utilities such as
 * borders, shadows and transforms silently do nothing. This repeats every default as a plain declaration.
 */
function withShadowRootDefaults(css: string): string {
  const defaults = [...css.matchAll(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g)].map(([, name, body]) => {
    const initialValue = body!.match(/initial-value:\s*([^;]+)/)?.[1]?.trim();
    return `${name}:${initialValue ?? 'initial'}`;
  });
  if (!defaults.length) return css;
  return `${css}\n@layer properties{*,::before,::after,::backdrop{${defaults.join(';')}}}`;
}

/** Compiles the Tailwind stylesheet for the classes used under src/ui. */
async function compileStyles(): Promise<string> {
  const tailwind = Bun.spawn(
    ['node_modules/.bin/tailwindcss', '--input', STYLES_ENTRY, '--output', COMPILED_STYLES, '--minify'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if ((await tailwind.exited) !== 0) throw new Error(`tailwind failed:\n${await new Response(tailwind.stderr).text()}`);
  return withShadowRootDefaults(await Bun.file(COMPILED_STYLES).text());
}

/** Serves the compiled stylesheet as the `virtual:mosaic-styles` module, so the UI can inject it as text. */
const stylesPlugin = (css: string): BunPlugin => ({
  name: 'mosaic-styles',
  setup(builder) {
    builder.onResolve({ filter: /^virtual:mosaic-styles$/ }, () => ({ path: 'styles', namespace: 'mosaic-styles' }));
    builder.onLoad({ filter: /.*/, namespace: 'mosaic-styles' }, () => ({
      contents: `export default ${JSON.stringify(css)};`,
      loader: 'js',
    }));
  },
});

/** Copies the manifest with the version from package.json, so a release only bumps one place. */
async function writeManifest() {
  const { version } = await Bun.file('package.json').json();
  const manifest = await Bun.file('src/manifest.json').json();
  await Bun.write(`${OUTPUT_DIRECTORY}/manifest.json`, JSON.stringify({ ...manifest, version }, null, 2));
}

async function build() {
  const startedAt = performance.now();
  await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await mkdir(HARNESS_DIRECTORY, { recursive: true });
  const plugins = [stylesPlugin(await compileStyles())];
  const common = {
    outdir: OUTPUT_DIRECTORY,
    target: 'browser' as const,
    minify: true,
    sourcemap: 'linked' as const,
    define: { 'process.env.NODE_ENV': '"production"' },
  };
  const results = await Promise.all([
    Bun.build({ ...common, entrypoints: ['src/background/index.ts'], format: 'esm', naming: 'background.js' }),
    Bun.build({ ...common, entrypoints: ['src/content/index.ts'], format: 'iife', naming: 'content.js' }),
    Bun.build({
      ...common,
      entrypoints: ['src/content/page-hook.ts'],
      format: 'iife',
      naming: 'page-hook.js',
      sourcemap: 'none',
    }),
    Bun.build({
      ...common,
      entrypoints: ['src/ui/entry.tsx'],
      format: 'esm',
      naming: 'ui.js',
      splitting: false,
      plugins,
    }),
    Bun.build({
      ...common,
      outdir: HARNESS_DIRECTORY,
      entrypoints: ['dev/harness.tsx'],
      format: 'esm',
      naming: 'harness.js',
      minify: false,
      plugins,
    }),
  ]);
  for (const result of results)
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error('build failed');
    }
  await writeManifest();
  await cp('src/icons', `${OUTPUT_DIRECTORY}/icons`, { recursive: true });
  await cp('dev/harness.html', `${HARNESS_DIRECTORY}/harness.html`);
  console.log(`built ${OUTPUT_DIRECTORY}/ in ${Math.round(performance.now() - startedAt)} ms`);
}

await build();
if (process.argv.includes('--watch')) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  for (const directory of ['src', 'dev'])
    watch(directory, { recursive: true }, () => {
      clearTimeout(pending);
      pending = setTimeout(() => build().catch(error => console.error(error.message)), 150);
    });
  console.log('watching src/ and dev/ …');
}
