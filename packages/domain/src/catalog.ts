import { Schema } from 'effect';
import type { SkillId } from './ids.ts';
import { SkillIndicatorId } from './ids.ts';
import { BADGE_POINTS_RANGE, MAX_SKILLS_CEILING, POINTS_RANGE } from './scoring/policy.ts';
import { LEVELS, Level, type SkillRole } from './vocabulary.ts';

/**
 * The content of a skill version: what each level looks like and the observable
 * behaviors (indicators) an observer may tick. Stored relationally
 * (skill_level, skill_indicator) and pinned by every observation rating.
 */
export const Indicator = Schema.Struct({
  id: SkillIndicatorId,
  /** Stable across versions, e.g. `l3-reframes-goal`. */
  lineageKey: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]{1,64}$/))),
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(3), Schema.isMaxLength(240))),
});
export type Indicator = typeof Indicator.Type;

export const SkillLevelDefinition = Schema.Struct({
  level: Level,
  summary: Schema.String.pipe(Schema.check(Schema.isMaxLength(400))),
  indicators: Schema.Array(Indicator),
});
export type SkillLevelDefinition = typeof SkillLevelDefinition.Type;

export const SkillDefinition = Schema.Struct({
  levels: Schema.Array(SkillLevelDefinition),
});
export type SkillDefinition = typeof SkillDefinition.Type;

/** A definition can be published when every level has a summary and indicators. */
export const isDefinitionComplete = (definition: {
  readonly levels: ReadonlyArray<{
    readonly summary: string;
    readonly indicators: ReadonlyArray<unknown>;
  }>;
}): boolean =>
  definition.levels.length === 4 &&
  definition.levels.every((l) => l.summary.trim().length > 0 && l.indicators.length > 0);

export const indicatorIds = (definition: SkillDefinition): ReadonlySet<string> =>
  new Set(definition.levels.flatMap((l) => l.indicators.map((i) => i.id)));

/** One rule a catalog edit breaks, against the field a form shows it beside. */
export interface CatalogProblem {
  readonly field: string;
  readonly message: string;
}

/** The longest summary of one level, and the indicator text bounds (as in the schemas above). */
export const LEVEL_SUMMARY_MAX = 400;
export const INDICATOR_TEXT = { min: 3, max: 240 } as const;
/** An input sanity limit, not a rule about skills. */
export const INDICATORS_PER_LEVEL_MAX = 12;
const LINEAGE_KEY = /^[a-z0-9-]{1,64}$/;

/** `"Client discovery & trust"` → `"client-discovery-trust"`: lower case, ASCII, at most `max` characters. */
export const slugify = (text: string, max = 60): string =>
  text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, max)
    .replace(/-+$/, '');

/** An indicator in an editor: carried-over indicators keep their lineage key; new ones have none yet. */
export interface IndicatorDraft {
  readonly lineageKey?: string | null | undefined;
  readonly text: string;
}
export interface LevelDraft {
  readonly level: Level;
  readonly summary: string;
  readonly indicators: ReadonlyArray<IndicatorDraft>;
}

/** A draft definition after checking: trimmed, in level order, every indicator with a lineage key. */
export interface PreparedLevel {
  readonly level: Level;
  readonly summary: string;
  readonly indicators: ReadonlyArray<{ readonly lineageKey: string; readonly text: string }>;
}

export type PreparedDefinition =
  | { readonly ok: true; readonly levels: ReadonlyArray<PreparedLevel> }
  | { readonly ok: false; readonly problems: ReadonlyArray<CatalogProblem> };

/**
 * Checks a draft definition and gives every new indicator a lineage key. A
 * draft may be incomplete (publishing requires `isDefinitionComplete`), but
 * what it holds must be storable: each level once, bounded text, and lineage
 * keys unique across the whole definition (one version holds each key once).
 * A carried-over indicator keeps its key, so analytics can follow it across
 * versions; a new one gets `l<level>-<words of its text>`, made unique.
 */
export const prepareDefinition = (levels: ReadonlyArray<LevelDraft>): PreparedDefinition => {
  const problems: Array<CatalogProblem> = [];
  const seen = new Set<number>();
  for (const l of levels) {
    if (!LEVELS.includes(l.level))
      problems.push({ field: 'definition', message: 'Use levels 1 to 4.' });
    else if (seen.has(l.level))
      problems.push({ field: `level${l.level}`, message: `Level ${l.level} appears twice.` });
    seen.add(l.level);
  }
  const keys = new Set<string>();
  for (const l of levels) {
    const field = `level${l.level}`;
    if (l.summary.trim().length > LEVEL_SUMMARY_MAX)
      problems.push({ field, message: `Keep the summary under ${LEVEL_SUMMARY_MAX} characters.` });
    if (l.indicators.length > INDICATORS_PER_LEVEL_MAX)
      problems.push({
        field,
        message: `Use at most ${INDICATORS_PER_LEVEL_MAX} indicators a level.`,
      });
    for (const i of l.indicators) {
      const text = i.text.trim();
      if (text.length < INDICATOR_TEXT.min || text.length > INDICATOR_TEXT.max)
        problems.push({
          field,
          message: `Write each indicator in ${INDICATOR_TEXT.min} to ${INDICATOR_TEXT.max} characters.`,
        });
      const key = i.lineageKey?.trim();
      if (!key) continue;
      if (!LINEAGE_KEY.test(key))
        problems.push({ field, message: `“${key}” is not a valid indicator key.` });
      else if (keys.has(key))
        problems.push({ field, message: `The indicator key “${key}” is used twice.` });
      keys.add(key);
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  const fresh = (level: Level, text: string) => {
    const base = `l${level}-${slugify(text, 40) || 'indicator'}`;
    let key = base;
    for (let n = 2; keys.has(key); n++) key = `${base}-${n}`;
    keys.add(key);
    return key;
  };
  return {
    ok: true,
    levels: levels
      .toSorted((a, b) => a.level - b.level)
      .map((l) => ({
        level: l.level,
        summary: l.summary.trim(),
        indicators: l.indicators.map((i) => {
          const text = i.text.trim();
          return { lineageKey: i.lineageKey?.trim() || fresh(l.level, text), text };
        }),
      })),
  };
};

/** Lineage keys a new version adds and drops against the one before it (for the audit record). */
export const lineageChanges = (
  before: ReadonlyArray<{ readonly indicators: ReadonlyArray<{ readonly lineageKey: string }> }>,
  after: ReadonlyArray<{ readonly indicators: ReadonlyArray<{ readonly lineageKey: string }> }>,
) => {
  const keysOf = (levels: typeof before) =>
    new Set(levels.flatMap((l) => l.indicators.map((i) => i.lineageKey)));
  const [was, next] = [keysOf(before), keysOf(after)];
  return {
    added: [...next].filter((k) => !was.has(k)).toSorted(),
    removed: [...was].filter((k) => !next.has(k)).toSorted(),
    kept: [...next].filter((k) => was.has(k)).length,
  };
};

/** A skill's own values over the tenant's credit policy; null uses the policy's. */
export interface SkillValues {
  readonly primaryPoints: number | null;
  readonly secondaryPoints: number | null;
  readonly badgePoints: number | null;
  readonly minPrimaryPoints: number | null;
}

const wholeIn = (n: number, min: number, max: number) =>
  Number.isInteger(n) && n >= min && n <= max;

/**
 * The bounds on a skill's own values: the same input sanity limits as the
 * tenant's policy (and the database checks). A primary-points minimum above
 * the skill's own badge total could never be met, so it is refused; against
 * the tenant's total it is capped when a badge is judged (`badgeCriteriaFor`).
 */
export const checkSkillValues = (values: SkillValues): ReadonlyArray<CatalogProblem> => {
  const problems: Array<CatalogProblem> = [];
  const points = `Use a whole number from ${POINTS_RANGE.min} to ${POINTS_RANGE.max}, or leave it empty.`;
  for (const field of ['primaryPoints', 'secondaryPoints'] as const) {
    const v = values[field];
    if (v !== null && !wholeIn(v, POINTS_RANGE.min, POINTS_RANGE.max))
      problems.push({ field, message: points });
  }
  const badge = values.badgePoints;
  if (badge !== null && !wholeIn(badge, BADGE_POINTS_RANGE.min, BADGE_POINTS_RANGE.max))
    problems.push({
      field: 'badgePoints',
      message: `Use a whole number from ${BADGE_POINTS_RANGE.min} to ${BADGE_POINTS_RANGE.max}, or leave it empty.`,
    });
  const minPrimary = values.minPrimaryPoints;
  const ceiling = badge ?? BADGE_POINTS_RANGE.max;
  if (minPrimary !== null && !wholeIn(minPrimary, 0, ceiling))
    problems.push({
      field: 'minPrimaryPoints',
      message:
        badge === null
          ? `Use a whole number from 0 to ${ceiling}, or leave it empty.`
          : `Use a whole number from 0 to this skill's badge total of ${badge}, or leave it empty.`,
    });
  return problems;
};

/** One skill on an activity template: its place in the work and, optionally, the template's value for it. */
export interface TemplateSkill {
  readonly skillId: SkillId;
  readonly role: SkillRole;
  readonly points: number | null;
}

/**
 * The rules for a template's skills: each skill once, at most one primary
 * (the same product rule as an activity's), values inside the points range,
 * and no more skills than one observation can rate.
 */
export const checkTemplateSkills = (
  skills: ReadonlyArray<TemplateSkill>,
): ReadonlyArray<CatalogProblem> => {
  const problems: Array<CatalogProblem> = [];
  if (new Set(skills.map((s) => s.skillId)).size !== skills.length)
    problems.push({ field: 'skills', message: 'Each skill can be listed once.' });
  if (skills.length > MAX_SKILLS_CEILING)
    problems.push({ field: 'skills', message: `List at most ${MAX_SKILLS_CEILING} skills.` });
  if (skills.filter((s) => s.role === 'primary').length > 1)
    problems.push({ field: 'skills', message: 'Only one skill can be primary.' });
  if (
    skills.some((s) => s.points !== null && !wholeIn(s.points, POINTS_RANGE.min, POINTS_RANGE.max))
  )
    problems.push({
      field: 'skills',
      message: `Use values from ${POINTS_RANGE.min} to ${POINTS_RANGE.max}, or leave them empty.`,
    });
  return problems;
};
