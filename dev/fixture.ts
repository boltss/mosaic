// A deterministic fake PR (~200 files) exercising every bucket, markdown previews,
// truncated diffs, a huge file and a "same edit" group. Used by the dev harness and e2e tests.
import type { DiffLine, FileDiff, FileSummary, PullRequest, ReviewSource } from '../src/shared/types.ts';

type Spec = {
  path: string;
  status: FileSummary['status'];
  lines: DiffLine[];
  isGenerated?: boolean;
  truncated?: boolean;
  markdown?: [string | null, string | null];
  /** Fill colours of the fake image before and after (null: no such side). */
  image?: [string | null, string | null];
};

const contextLine = (text: string): DiffLine => ({ kind: 'context', text });
const addedLine = (text: string): DiffLine => ({ kind: 'addition', text });
const removedLine = (text: string): DiffLine => ({ kind: 'deletion', text });

function numberLines(lines: DiffLine[]): DiffLine[] {
  let oldNumber = 10,
    newNumber = 10;
  const numbered: DiffLine[] = [{ kind: 'hunk', text: `@@ -10 +10 @@` }];
  for (const line of lines)
    numbered.push(
      line.kind === 'addition'
        ? { ...line, newNumber: newNumber++ }
        : line.kind === 'deletion'
          ? { ...line, oldNumber: oldNumber++ }
          : { ...line, oldNumber: oldNumber++, newNumber: newNumber++ },
    );
  return numbered;
}

const importedNames = ['colors, spacing', 'colors', 'colors, typography', 'spacing, radii'];
const sameEdit = (name: string, index: number, upPath: string, extraLines: DiffLine[] = []): DiffLine[] => {
  const names = importedNames[index % importedNames.length]!;
  return [
    contextLine("import React from 'react';"),
    removedLine(`import { ${names} } from '${upPath}theme';`),
    addedLine(`import { ${names} } from '@acme/design-tokens';`),
    contextLine(''),
    contextLine(`export function ${name}() {`),
    ...extraLines,
    contextLine('  return null;'),
    contextLine('}'),
  ];
};

export function buildFixture() {
  const specs: Spec[] = [];
  const screens = [
    'Dashboard',
    'Workouts',
    'Journal',
    'Habit',
    'Reminders',
    'Insights',
    'Profile',
    'Settings',
    'Onboarding',
    'Export',
  ];
  screens.forEach((screen, index) => {
    const directory = `apps/mobile/src/screens/${screen}`;
    specs.push({
      path: `${directory}/${screen}Screen.tsx`,
      status: 'modified',
      lines: sameEdit(
        `${screen}Screen`,
        index,
        '../../',
        screen === 'Settings' ? [addedLine("  trackEvent('settings_open');")] : [],
      ),
    });
    specs.push({
      path: `${directory}/styles.ts`,
      status: 'modified',
      lines: sameEdit(`${screen}Styles`, index + 1, '../../'),
    });
    specs.push({
      path: `${directory}/use${screen}Data.ts`,
      status: 'modified',
      lines: [
        contextLine(`export function use${screen}Data(userId: string) {`),
        removedLine(`  const { data } = useQuery(['${screen}', userId], fetch${screen});`),
        addedLine('  const prefs = useThemePrefs(userId);'),
        addedLine(
          `  const { data, error } = useQuery({ queryKey: ['${screen}', userId, prefs.goalScale], queryFn: () => fetch${screen}(userId) });`,
        ),
        ...Array.from({ length: 9 }, (_unused, step) => contextLine(`  const v${step} = compute${step}(data);`)),
        removedLine('  return normalize(data);'),
        addedLine(`  if (error) reportError(error, { screen: '${screen}' });`),
        addedLine('  return normalize(data, prefs.goalScale);'),
        contextLine('}'),
      ],
    });
  });
  const components = [
    'Button',
    'Card',
    'Chip',
    'Header',
    'Avatar',
    'Modal',
    'Tabs',
    'Badge',
    'Toast',
    'Input',
    'Sheet',
    'Divider',
  ];
  components.forEach((component, index) =>
    specs.push({
      path: `apps/mobile/src/components/${component}.tsx`,
      status: 'modified',
      lines: sameEdit(component, index, '../'),
    }),
  );
  components.slice(0, 8).forEach(component =>
    specs.push({
      path: `apps/mobile/src/components/__snapshots__/${component}.test.tsx.snap`,
      status: 'modified',
      lines: [
        contextLine(`exports[\`${component} 1\`] = \``),
        removedLine('  "backgroundColor": "#1A73E8",'),
        addedLine('  "backgroundColor": "#1B6EF3",'),
        contextLine('`;'),
      ],
    }),
  );
  for (const model of [
    'Member',
    'Checkin',
    'Habit',
    'Entry',
    'Reminder',
    'Journal',
    'Insight',
    'Trigger',
    'Team',
    'Export',
    'Session',
    'Profile',
    'Device',
    'Consent',
    'Tag',
    'Note',
    'Goal',
    'Survey',
    'Answer',
    'Plan',
    'Invite',
    'Streak',
    'Category',
    'Attachment',
    'Subscription',
  ])
    specs.push({
      path: `packages/api-client/src/generated/${model}Dto.ts`,
      status: 'modified',
      isGenerated: true,
      lines: [
        contextLine(`export interface ${model}Dto {`),
        contextLine('  id: string;'),
        addedLine("  themeVariant?: 'light' | 'dark' | 'system';"),
        contextLine('}'),
      ],
    });
  for (const locale of ['en', 'et', 'ru', 'fi', 'lv', 'de'])
    specs.push({
      path: `apps/mobile/src/locales/${locale}.json`,
      status: 'modified',
      lines: [
        contextLine('  "settings.title": "…",'),
        addedLine('  "settings.theme.title": "…",'),
        addedLine('  "settings.theme.dark": "…",'),
        contextLine('}'),
      ],
    });
  for (const name of ['colors', 'spacing', 'typography'])
    specs.push({
      path: `apps/mobile/src/theme/legacy/${name}.ts`,
      status: 'deleted',
      lines: [removedLine(`export const legacy_${name} = {`), removedLine("  primary: '#1A73E8',"), removedLine('};')],
    });
  for (const name of ['shadows', 'radii'])
    specs.push({ path: `packages/design-tokens/src/${name}.ts`, status: 'renamed', lines: [] });
  for (const name of ['format', 'date', 'clamp'])
    specs.push({
      path: `apps/mobile/src/utils/${name}.ts`,
      status: 'modified',
      lines: [
        contextLine(`export function ${name}(v: string) {`),
        removedLine('  return  v.trim();'),
        addedLine('    return v.trim();  '),
        contextLine('}'),
      ],
    });
  specs.push({
    path: 'apps/mobile/src/utils/indent.py',
    status: 'modified',
    lines: [contextLine('def f():'), removedLine('  return 1'), addedLine('    return 1')],
  });
  specs.push({
    path: 'bun.lock',
    status: 'modified',
    lines: [
      contextLine('    "@acme/api-client": ["workspace"],'),
      addedLine('    "@acme/design-tokens": ["workspace"],'),
    ],
  });
  specs.push({
    path: 'apps/mobile/src/utils/__tests__/format.test.ts',
    status: 'added',
    lines: [
      "import { format } from '../format';",
      '',
      "describe('format', () => {",
      '  beforeEach(() => {',
      '    jest.resetAllMocks();',
      '  });',
      ...[
        'trims surrounding whitespace',
        'keeps inner spaces',
        'returns an empty string for null',
        'formats goal scores out of ten',
      ].flatMap(name => [`  it('${name}', () => {`, "    expect(format(' a ')).toBe('a');", '  });']),
      '});',
    ].map(addedLine),
  });
  specs.push({ path: 'apps/mobile/assets/icon.png', status: 'modified', lines: [], image: ['#1A73E8', '#1B6EF3'] });
  specs.push({ path: 'apps/mobile/assets/splash.png', status: 'added', lines: [], image: [null, '#3fb950'] });
  specs.push({
    path: 'apps/mobile/package.json',
    status: 'modified',
    lines: [
      contextLine('  "dependencies": {'),
      addedLine('    "@acme/design-tokens": "workspace:*",'),
      contextLine('    "react": "19.1.0",'),
    ],
  });
  specs.push({
    path: 'supabase/migrations/20261002_theme_prefs.sql',
    status: 'added',
    lines: [
      'create table public.theme_prefs (',
      '  user_id uuid primary key references auth.users on delete cascade,',
      "  variant text not null default 'system',",
      '  goal_scale smallint not null default 10',
      ');',
      'alter table public.theme_prefs enable row level security;',
    ].map(addedLine),
  });
  specs.push({
    path: 'apps/mobile/src/screens/Settings/ThemeSettingsSection.tsx',
    status: 'added',
    lines: Array.from({ length: 52 }, (_unused, index) =>
      addedLine(
        index % 7 === 0
          ? ''
          : `  const row${index} = <Row key="${index}" label={t('settings.theme.row${index}')} onPress={() => pick(${index})} disabled={isSaving && ${index} % 2 === 0} />;`,
      ),
    ),
  });
  specs.push({
    path: 'apps/mobile/src/data/seed-exercises.ts',
    status: 'modified',
    truncated: true,
    lines: Array.from({ length: 360 }, (_unused, index) =>
      index % 3
        ? addedLine(`  { id: ${index}, name: 'Exercise ${index}', reps: ${index % 12} },`)
        : removedLine(`  { id: ${index}, name: 'Old ${index}' },`),
    ),
  });
  specs.push({
    path: 'apps/web/src/api/client.ts',
    status: 'modified',
    truncated: true,
    lines: [
      contextLine('export async function get(url: string) {'),
      removedLine('  return fetch(url);'),
      addedLine('  return fetch(url, { credentials: "include" });'),
      contextLine('}'),
    ],
  });

  const oldAgents =
    '# Agents\n\nIntro paragraph.\n\n## Localization\n\nAll user-facing strings go through `t()`.\n\n- Add keys to `en.json` first\n- Run `bun run i18n:check`\n\nFollow the [style guide](docs/style.md) for tone.\n\n## Testing\n\nRun `bun test` before pushing.\n\n<!-- owner: @alice -->\n';
  const newAgents =
    '# Agents\n\nIntro paragraph.\n\n## Localization\n\nAll user-facing strings go through `t()` and must have an Estonian translation.\n\n- Add keys to `en.json` and `et.json`\n- Run `bun run i18n:check`\n\nFollow the [style guide](docs/STYLE.md) for tone.\n\n## Commits\n\nUse conventional commits: `feat:`, `fix:`, `chore:`.\n\n<!-- owner: @roger -->\n';
  const skill =
    '---\nname: localization\ndescription: Use when adding or editing user-facing copy\n---\n# Localization skill\n\nEvery string shown to users must live in `locales/*.json`.\n\n1. Add the key to `en.json`\n2. Add the Estonian text to `et.json`\n3. Run `bun run i18n:check`\n\n![diagram](./diagram.png)\n';
  const markdownLines = (oldSource: string | null, newSource: string | null): DiffLine[] => [
    ...(oldSource ?? '').split('\n').filter(Boolean).map(removedLine),
    ...(newSource ?? '').split('\n').filter(Boolean).map(addedLine),
  ];
  specs.push({
    path: 'AGENTS.md',
    status: 'modified',
    lines: markdownLines(oldAgents, newAgents),
    markdown: [oldAgents, newAgents],
  });
  specs.push({
    path: '.claude/skills/localization/SKILL.md',
    status: 'added',
    lines: markdownLines(null, skill),
    markdown: [null, skill],
  });

  const files: FileSummary[] = specs.map(spec => ({
    path: spec.path,
    status: spec.status,
    viewed: spec.path.endsWith('.json') && spec.path.includes('locales/e'),
    additions: spec.lines.filter(line => line.kind === 'addition').length,
    deletions: spec.lines.filter(line => line.kind === 'deletion').length,
  }));
  const diffs = new Map(
    specs.map(spec => [
      spec.path,
      {
        path: spec.path,
        lines: spec.lines.length ? numberLines(spec.lines) : [],
        complete: true,
        source: 'raw',
        isGenerated: spec.isGenerated,
        binary: !!spec.image || undefined,
      } as FileDiff,
    ]),
  );
  return { specs, files, diffs };
}

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export function fixtureSource(
  options: { latency?: number; failViewed?: boolean } = {},
): ReviewSource & { viewedLog: string[] } {
  const { specs, files, diffs } = buildFixture();
  const viewed = new Map(files.map(file => [file.path, file.viewed]));
  const latency = options.latency ?? 250;
  const pullRequest: PullRequest = {
    owner: 'acme',
    repository: 'habit-tracker',
    number: 410,
    title: 'Move theme to @acme/design-tokens, add theme preferences',
    range: 'f'.repeat(40),
    headCommitId: 'f'.repeat(40),
    baseCommitId: 'e'.repeat(40),
  };
  const viewedLog: string[] = [];
  return {
    viewedLog,
    async loadPullRequest() {
      await sleep(latency);
      return { pullRequest, files: files.map(file => ({ ...file, viewed: viewed.get(file.path)! })) };
    },
    planDiffBatches: paths => {
      const batches: string[][] = [];
      for (let start = 0; start < paths.length; start += 40) batches.push(paths.slice(start, start + 40));
      return batches;
    },
    async loadDiffBatch(_pullRequest, paths) {
      await sleep(latency + Math.random() * latency * 3);
      return paths.map(path => {
        const spec = specs.find(candidate => candidate.path === path)!,
          diff = diffs.get(path)!;
        return spec.truncated
          ? { ...diff, lines: diff.lines.slice(0, 3), complete: false, source: 'entries' as const }
          : { ...diff, source: 'entries' as const };
      });
    },
    async loadRawDiff() {
      await sleep(latency * 6);
      return diffs;
    },
    async setViewed(_pullRequest, path, isViewed) {
      await sleep(80 + Math.random() * 200);
      if (options.failViewed && path.includes('Dashboard')) throw new Error('HTTP 422');
      viewed.set(path, isViewed);
      viewedLog.push(`${isViewed ? '+' : '-'}${path}`);
    },
    async loadFileContent(_pullRequest, path, side) {
      await sleep(latency);
      const spec = specs.find(candidate => candidate.path === path);
      return spec?.markdown ? spec.markdown[side === 'old' ? 0 : 1] : null;
    },
    async loadImage(_pullRequest, path, side) {
      await sleep(latency);
      const fill = specs.find(candidate => candidate.path === path)?.image?.[side === 'old' ? 0 : 1];
      if (!fill) return null;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" rx="12" fill="${fill}"/></svg>`;
      return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, bytes: svg.length };
    },
    blobUrl: (_pullRequest, path, kind) =>
      `https://github.com/acme/habit-tracker/${kind}/${pullRequest.headCommitId}/${path}`,
    githubUrl: (_pullRequest, path) =>
      `https://github.com/acme/habit-tracker/pull/410/changes${path ? `#${encodeURIComponent(path)}` : ''}`,
  };
}
