import { IsoDate, PersonId, SkillDomain, SkillId } from '@repo/domain';
import { Schema } from 'effect';

/** ISO-8601 instant (UTC), e.g. `2026-11-16T14:03:00.000Z`. */
export const Instant = Schema.String;

export const PersonSummary = Schema.Struct({
  id: PersonId,
  displayName: Schema.String,
  title: Schema.NullOr(Schema.String),
  initials: Schema.String,
  /** Stable 0-359 hue for avatar tinting. */
  hue: Schema.Number,
});
export type PersonSummary = typeof PersonSummary.Type;

export const SkillRef = Schema.Struct({
  id: SkillId,
  slug: Schema.String,
  name: Schema.String,
  domain: SkillDomain,
});
export type SkillRef = typeof SkillRef.Type;

export const CriterionView = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  met: Schema.Boolean,
  current: Schema.Number,
  required: Schema.Number,
});
export type CriterionView = typeof CriterionView.Type;

/** Progress toward the next badge in one skill. Benchmarks, never ranks. */
export const ProgressView = Schema.Struct({
  skill: SkillRef,
  heldLevels: Schema.Array(Schema.Number),
  targetLevel: Schema.NullOr(Schema.Number),
  targetLevelName: Schema.NullOr(Schema.String),
  /** Distinct interactions demonstrating the skill at or above the target level. */
  demonstrations: Schema.Number,
  criteria: Schema.Array(CriterionView),
  nextStep: Schema.String,
  lastDemonstratedOn: Schema.NullOr(IsoDate),
});
export type ProgressView = typeof ProgressView.Type;

export const Page = <S extends Schema.Top>(item: S) =>
  Schema.Struct({ items: Schema.Array(item), total: Schema.Number });
