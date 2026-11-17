import {
  ActivityTemplateId,
  InteractionKind,
  SkillLevelDefinition,
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

export const TemplateCard = Schema.Struct({
  id: ActivityTemplateId,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  kind: InteractionKind,
  suggestedSkills: Schema.Array(SkillRef),
  typicalMinutes: Schema.NullOr(Schema.Number),
  observationTip: Schema.NullOr(Schema.String),
});
export type TemplateCard = typeof TemplateCard.Type;

export const BadgeHolder = Schema.Struct({
  person: PersonSummary,
  level: Schema.Number,
  levelName: Schema.String,
});

export const SkillDetail = Schema.Struct({
  ...SkillCard.fields,
  versionId: SkillVersionId,
  version: Schema.Number,
  levels: Schema.Array(SkillLevelDefinition),
  holders: Schema.Array(BadgeHolder),
  templates: Schema.Array(TemplateCard),
  myProgress: Schema.NullOr(ProgressView),
});
export type SkillDetail = typeof SkillDetail.Type;
