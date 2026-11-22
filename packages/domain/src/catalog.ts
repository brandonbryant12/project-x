import { Schema } from 'effect';
import { SkillIndicatorId } from './ids.ts';
import { Level } from './vocabulary.ts';

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

export const RESOURCE_KINDS = [
  'playbook',
  'script',
  'sample_call',
  'guide',
  'video',
  'course',
] as const;
export const ResourceKind = Schema.Literals(RESOURCE_KINDS);
export type ResourceKind = typeof ResourceKind.Type;

/** Curated level-up playbook item attached to a skill level (1–4). */
export const SkillResource = Schema.Struct({
  id: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  level: Level,
  kind: ResourceKind,
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(2), Schema.isMaxLength(140))),
  summary: Schema.String.pipe(Schema.check(Schema.isMaxLength(400))),
  url: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(500)))),
  durationMinutes: Schema.NullOr(
    Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  ),
});
export type SkillResource = typeof SkillResource.Type;

/** A definition can be published when every level has a summary and indicators. */
export const isDefinitionComplete = (definition: SkillDefinition): boolean =>
  definition.levels.length === 4 &&
  definition.levels.every((l) => l.summary.trim().length > 0 && l.indicators.length > 0);

export const indicatorIds = (definition: SkillDefinition): ReadonlySet<string> =>
  new Set(definition.levels.flatMap((l) => l.indicators.map((i) => i.id)));
