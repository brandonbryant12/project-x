import * as Domain from '@alchemy.run/domain';
import { Schema } from 'effect';
import { SkillTier } from '../scoring/catalog-insights.ts';
import {
  IsoDate,
  ObservationId,
  PersonId,
  SkillId,
  SkillIndicatorId,
  SkillVersionId,
  type TenantId,
} from '../ids.ts';
import { Level, ObservationMode, SkillDomain } from '../vocabulary.ts';

/** Composite key for one person's credit & badge ledger in one skill: `<tenantId>:<personId>:<skillId>`. */
export const SkillLedgerId = Schema.String.pipe(Schema.brand('SkillLedgerId'));
export type SkillLedgerId = typeof SkillLedgerId.Type;

export const skillLedgerId = (
  tenantId: TenantId,
  personId: PersonId,
  skillId: SkillId,
): SkillLedgerId => `${tenantId}:${personId}:${skillId}` as SkillLedgerId;

export const parseSkillLedgerId = (
  id: SkillLedgerId,
): { readonly tenantId: TenantId; readonly personId: PersonId; readonly skillId: SkillId } => {
  const [tenantId = '', personId = '', skillId = ''] = id.split(':');
  return {
    tenantId: tenantId as TenantId,
    personId: personId as PersonId,
    skillId: skillId as SkillId,
  };
};

/** Composite key for per-person mastery read views: `<tenantId>:<personId>`. */
export const PersonMasteryKey = Schema.String.pipe(Schema.brand('PersonMasteryKey'));
export type PersonMasteryKey = typeof PersonMasteryKey.Type;

export const personMasteryKey = (tenantId: TenantId, personId: PersonId): PersonMasteryKey =>
  `${tenantId}:${personId}` as PersonMasteryKey;

/** Shared immutable fact schema for one rated skill on a signed observation. */
export const SkillRatingFact = Schema.Struct({
  skillId: SkillId,
  skillVersionId: SkillVersionId,
  level: Level,
  credit: Schema.Boolean,
  indicatorIds: Schema.Array(SkillIndicatorId),
});
export type SkillRatingFact = typeof SkillRatingFact.Type;

/** Shared tenant badge-rigor policy criteria schema. */
export const BadgeCriteriaFact = Schema.Struct({
  minDemonstrations: Schema.Int,
  minObservers: Schema.Int,
  minFirstHandShare: Schema.Number,
  minSpanDays: Schema.Int,
});
export type BadgeCriteriaFact = typeof BadgeCriteriaFact.Type;

/** Shared skill level rubric draft schema for catalog authoring. */
export const SkillLevelFact = Schema.Struct({
  level: Level,
  summary: Schema.String,
  indicators: Schema.Array(Schema.String),
});
export type SkillLevelFact = typeof SkillLevelFact.Type;

/** Shared raw demonstration fact stored inside `SkillLedger` so scoring/badge rules stay swappable. */
export const DemonstrationFact = Schema.Struct({
  observationId: ObservationId,
  interactionId: Schema.String,
  observerId: PersonId,
  level: Level,
  mode: ObservationMode,
  demonstratedOn: IsoDate,
});
export type DemonstrationFact = typeof DemonstrationFact.Type;

/** Shared typed domain rejections with HTTP status annotations. */
export class InvalidTransition extends Domain.Rejection(
  'InvalidTransition',
  {
    entity: Schema.String,
    from: Schema.String,
    event: Schema.String,
    reason: Schema.String,
  },
  { httpApiStatus: 409, description: 'The entity cannot accept this action in its current state.' },
) {}

export class UnauthorizedActor extends Domain.Rejection(
  'UnauthorizedActor',
  { action: Schema.String, reason: Schema.String },
  { httpApiStatus: 403, description: 'The caller lacks permission for this action.' },
) {}

export class PrivacyViolation extends Domain.Rejection(
  'PrivacyViolation',
  { reasons: Schema.Array(Schema.String) },
  {
    httpApiStatus: 422,
    description: 'Narrative text appears to contain client PII and cannot be signed.',
  },
) {}

export class InvalidDomainInput extends Domain.Rejection(
  'InvalidDomainInput',
  { field: Schema.String, reason: Schema.String },
  { httpApiStatus: 422, description: 'Command payload failed a domain invariant.' },
) {}

export class AlreadyExists extends Domain.Rejection(
  'AlreadyExists',
  { entity: Schema.String, id: Schema.String },
  { httpApiStatus: 409, description: 'An aggregate instance with this identity already exists.' },
) {}

export class NotFoundInDomain extends Domain.Rejection(
  'NotFoundInDomain',
  { entity: Schema.String, id: Schema.String },
  { httpApiStatus: 404, description: 'No aggregate instance exists for this identity.' },
) {}

export const SkillMetadataFact = {
  slug: Schema.String,
  name: Schema.String,
  domain: SkillDomain,
  tier: SkillTier,
  summary: Schema.String,
  outcome: Schema.String,
  tags: Schema.Array(Schema.String),
} as const;
