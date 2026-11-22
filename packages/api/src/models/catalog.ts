import {
  ActivityTemplateId,
  InteractionKind,
  SkillId,
  SkillLevelDefinition,
  SkillSignal,
  SkillTier,
  SkillVersionId,
} from '@repo/domain';
import { Schema } from 'effect';
import { PersonSummary, ProgressView, SkillRef } from './common.ts';

export const SkillCard = Schema.Struct({
  ...SkillRef.fields,
  summary: Schema.String,
  outcome: Schema.String,
  tier: SkillTier,
  tags: Schema.Array(Schema.String),
  holderCount: Schema.Number,
  activeFocusCount: Schema.Number,
  signal: SkillSignal,
  inMyPlan: Schema.Boolean,
  myHighestLevel: Schema.NullOr(Schema.Number),
  myCurrent: Schema.Number,
  myRequired: Schema.Number,
});
export type SkillCard = typeof SkillCard.Type;

export const SkillCombo = Schema.Struct({
  skills: Schema.Tuple([SkillRef, SkillRef]),
  jointHolders: Schema.Number,
  matchesViewer: Schema.Boolean,
  viewerHeldSkillId: Schema.NullOr(SkillId),
  rationale: Schema.String,
});
export type SkillCombo = typeof SkillCombo.Type;

export const TagSummary = Schema.Struct({
  tag: Schema.String,
  count: Schema.Number,
});
export type TagSummary = typeof TagSummary.Type;

export const CatalogInsights = Schema.Struct({
  totalPeople: Schema.Number,
  popularSkillIds: Schema.Array(SkillId),
  lackingSkillIds: Schema.Array(SkillId),
  rareCombos: Schema.Array(SkillCombo),
  tags: Schema.Array(TagSummary),
});
export type CatalogInsights = typeof CatalogInsights.Type;

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
  rarePairings: Schema.Array(SkillCombo),
});
export type SkillDetail = typeof SkillDetail.Type;
