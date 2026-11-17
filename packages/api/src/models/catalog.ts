import {
  ActivityTemplateId,
  InteractionKind,
  SkillLevelDefinition,
  SkillRole,
  SkillVersionId,
} from '@repo/domain';
import { Schema } from 'effect';
import { PersonSummary, ProgressView, SkillRef } from './common.ts';

export const SkillCard = Schema.Struct({
  ...SkillRef.fields,
  summary: Schema.String,
  outcome: Schema.String,
  tags: Schema.Array(Schema.String),
  holderCount: Schema.Number,
  inMyPlan: Schema.Boolean,
  myHighestLevel: Schema.NullOr(Schema.Number),
});
export type SkillCard = typeof SkillCard.Type;

/** A skill on a template: its place in the work, and the template's own value when it has one. */
export const TemplateSkillView = Schema.Struct({
  skill: SkillRef,
  role: SkillRole,
  points: Schema.NullOr(Schema.Number),
});
export type TemplateSkillView = typeof TemplateSkillView.Type;

export const TemplateCard = Schema.Struct({
  id: ActivityTemplateId,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  kind: InteractionKind,
  suggestedSkills: Schema.Array(SkillRef),
  /** The same skills, in order, with their roles and values. */
  skills: Schema.Array(TemplateSkillView),
  typicalMinutes: Schema.NullOr(Schema.Number),
  observationTip: Schema.NullOr(Schema.String),
});
export type TemplateCard = typeof TemplateCard.Type;

export const BadgeHolder = Schema.Struct({
  person: PersonSummary,
  level: Schema.Number,
  levelName: Schema.String,
});

/** A value this skill sets for itself that differs from the tenant's. */
export const SkillValueDifference = Schema.Struct({
  key: Schema.Literals(['primaryPoints', 'secondaryPoints', 'badgePoints', 'minPrimaryPoints']),
  value: Schema.Number,
  tenantValue: Schema.Number,
});
export type SkillValueDifference = typeof SkillValueDifference.Type;

export const SkillDetail = Schema.Struct({
  ...SkillCard.fields,
  versionId: SkillVersionId,
  version: Schema.Number,
  levels: Schema.Array(SkillLevelDefinition),
  holders: Schema.Array(BadgeHolder),
  templates: Schema.Array(TemplateCard),
  myProgress: Schema.NullOr(ProgressView),
  /** Only the values that differ from the tenant's credit rules. */
  valueDifferences: Schema.Array(SkillValueDifference),
});
export type SkillDetail = typeof SkillDetail.Type;
