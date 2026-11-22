import {
  ActivityTemplateId,
  InteractionKind,
  Level,
  ResourceKind,
  SkillDomain,
  SkillId,
  SkillLevelDefinition,
  SkillResource,
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
  resourceCount: Schema.Number,
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
  resources: Schema.Array(SkillResource),
  holders: Schema.Array(BadgeHolder),
  templates: Schema.Array(TemplateCard),
  myProgress: Schema.NullOr(ProgressView),
  rarePairings: Schema.Array(SkillCombo),
});
export type SkillDetail = typeof SkillDetail.Type;

export const AuthorLevelInput = Schema.Struct({
  level: Level,
  summary: Schema.String.pipe(Schema.check(Schema.isMinLength(3), Schema.isMaxLength(400))),
  indicators: Schema.Array(
    Schema.String.pipe(Schema.check(Schema.isMinLength(3), Schema.isMaxLength(240))),
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(8))),
});

export const AuthorSkillInput = Schema.Struct({
  name: Schema.String.pipe(Schema.check(Schema.isMinLength(2), Schema.isMaxLength(100))),
  slug: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]{2,80}$/)))),
  domain: SkillDomain,
  tier: SkillTier,
  summary: Schema.String.pipe(Schema.check(Schema.isMinLength(5), Schema.isMaxLength(320))),
  outcome: Schema.String.pipe(Schema.check(Schema.isMinLength(2), Schema.isMaxLength(120))),
  tags: Schema.Array(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(40))),
  ),
  levels: Schema.Array(AuthorLevelInput).pipe(
    Schema.check(Schema.isMinLength(4), Schema.isMaxLength(4)),
  ),
});
export type AuthorSkillInput = typeof AuthorSkillInput.Type;

export const UpdateSkillInput = Schema.Struct({
  name: Schema.String.pipe(Schema.check(Schema.isMinLength(2), Schema.isMaxLength(100))),
  domain: SkillDomain,
  tier: SkillTier,
  summary: Schema.String.pipe(Schema.check(Schema.isMinLength(5), Schema.isMaxLength(320))),
  outcome: Schema.String.pipe(Schema.check(Schema.isMinLength(2), Schema.isMaxLength(120))),
  tags: Schema.Array(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(40))),
  ),
  levels: Schema.optional(
    Schema.Array(AuthorLevelInput).pipe(Schema.check(Schema.isMinLength(4), Schema.isMaxLength(4))),
  ),
  changeNote: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(200)))),
});
export type UpdateSkillInput = typeof UpdateSkillInput.Type;

export const AddSkillResourceInput = Schema.Struct({
  level: Level,
  kind: ResourceKind,
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(2), Schema.isMaxLength(140))),
  summary: Schema.String.pipe(Schema.check(Schema.isMaxLength(400))),
  url: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(500)))),
  durationMinutes: Schema.NullOr(
    Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  ),
});
export type AddSkillResourceInput = typeof AddSkillResourceInput.Type;
