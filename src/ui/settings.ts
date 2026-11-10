// The reviewer's saved preferences. Read from storage through the schema, so a missing or
// outdated value falls back to its default instead of reaching the UI.
import * as zod from 'zod';
import { bucketSettingsSchema } from '../review/classify.ts';

export const densitySchema = zod.enum(['small', 'medium', 'large']);
export type Density = zod.infer<typeof densitySchema>;

export const DENSITIES: Record<Density, { label: string; tileWidth: number; codeSize: string }> = {
  small: { label: 'S', tileWidth: 230, codeSize: '10px' },
  medium: { label: 'M', tileWidth: 300, codeSize: '10.5px' },
  large: { label: 'L', tileWidth: 400, codeSize: '11.5px' },
};
export const DENSITY_ORDER: Density[] = ['small', 'medium', 'large'];

export const viewModeSchema = zod.enum(['preview', 'code']);
/** How a markdown or test file is shown: rendered/outlined, or as its plain diff. */
export type ViewMode = zod.infer<typeof viewModeSchema>;

/** Settings saved before names were spelled out; read them as the current ones. */
const LEGACY_FIELDS: Record<string, string> = { mdDefault: 'markdownDefault' };
const LEGACY_DENSITIES: Record<string, Density> = { S: 'small', M: 'medium', L: 'large' };
const LEGACY_BUCKETS: Record<string, string> = { i18n: 'translations', same: 'sameEdit' };

const renameKeys = (value: unknown, names: Record<string, string>): unknown =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [names[key] ?? key, entry]))
    : value;

export const settingsSchema = zod.preprocess(
  value => renameKeys(value ?? {}, LEGACY_FIELDS),
  zod.object({
    buckets: zod.preprocess(value => renameKeys(value, LEGACY_BUCKETS), bucketSettingsSchema).catch({}),
    density: zod
      .preprocess(value => (typeof value === 'string' ? (LEGACY_DENSITIES[value] ?? value) : value), densitySchema)
      .catch('medium'),
    markdownDefault: viewModeSchema.catch('preview'),
    testDefault: viewModeSchema.catch('preview'),
  }),
);
export type Settings = zod.infer<typeof settingsSchema>;

export const SETTINGS_KEY = 'settings';
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});
