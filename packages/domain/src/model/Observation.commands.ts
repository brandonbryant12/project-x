import * as Domain from '@alchemy.run/domain';
import { Schema } from 'effect';
import { InteractionId, IsoDate, ObservationId, PersonId, SkillId, TenantId } from '../ids.ts';
import { ObservationMode, ObserverBasis } from '../vocabulary.ts';
import { CoachingSession } from './CoachingActor.context.ts';
import {
  AlreadyExists,
  InvalidDomainInput,
  InvalidTransition,
  PrivacyViolation,
  SkillRatingFact,
  UnauthorizedActor,
} from './Shared.ts';

/* ── Immutable Business Fact Events (NEVER store raw narrative PII — ADR 0015) ── */

export class ObservationRequested extends Domain.Event('ObservationRequested', {
  tenantId: TenantId,
  subjectId: PersonId,
  observerId: PersonId,
  requestedById: PersonId,
  interactionId: InteractionId,
  occurredOn: IsoDate,
  basis: ObserverBasis,
  mode: ObservationMode,
  requestedSkillIds: Schema.Array(SkillId),
}) {}

export class ObservationStarted extends Domain.Event('ObservationStarted', {
  tenantId: TenantId,
  subjectId: PersonId,
  observerId: PersonId,
  interactionId: InteractionId,
  occurredOn: IsoDate,
  basis: ObserverBasis,
  mode: ObservationMode,
  skillIds: Schema.Array(SkillId),
}) {}

export class ObservationDraftSaved extends Domain.Event('ObservationDraftSaved', {
  mode: ObservationMode,
  ratedSkillCount: Schema.Int,
  narrativeLength: Schema.Int,
}) {}

export class ObservationSigned extends Domain.Event('ObservationSigned', {
  tenantId: TenantId,
  subjectId: PersonId,
  observerId: PersonId,
  interactionId: InteractionId,
  occurredOn: IsoDate,
  basis: ObserverBasis,
  mode: ObservationMode,
  ratings: Schema.Array(SkillRatingFact),
  contentDigest: Schema.String,
}) {}

export class ObservationReturned extends Domain.Event('ObservationReturned', {
  tenantId: TenantId,
  requestedById: PersonId,
  returnedById: PersonId,
}) {}

export class ObservationResubmitted extends Domain.Event('ObservationResubmitted', {
  resubmittedById: PersonId,
}) {}

export class ObservationAcknowledged extends Domain.Event('ObservationAcknowledged', {
  subjectId: PersonId,
}) {}

export class ObservationReviewRequested extends Domain.Event('ObservationReviewRequested', {
  requestedById: PersonId,
}) {}

export class ObservationUpheld extends Domain.Event('ObservationUpheld', {
  reviewerId: PersonId,
}) {}

export class ObservationVoided extends Domain.Event('ObservationVoided', {
  tenantId: TenantId,
  subjectId: PersonId,
  observerId: PersonId,
  creditedSkillIds: Schema.Array(SkillId),
  voidedById: PersonId,
}) {}

export class ObservationDeclined extends Domain.Event('ObservationDeclined', {
  declinedById: PersonId,
}) {}

export class ObservationWithdrawn extends Domain.Event('ObservationWithdrawn', {
  withdrawnById: PersonId,
}) {}

export class ObservationExpired extends Domain.Event('ObservationExpired', {}) {}

/* ── Commands ── */

export class RequestObservation extends Domain.Command(
  'RequestObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: {
      subjectId: PersonId,
      observerId: PersonId,
      interactionId: InteractionId,
      occurredOn: IsoDate,
      basis: ObserverBasis,
      mode: ObservationMode,
      skillIds: Schema.Array(SkillId),
    },
    events: [ObservationRequested],
    rejects: [AlreadyExists, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Coachee requests an observation from an eligible observer.' },
) {}

export class StartObservation extends Domain.Command(
  'StartObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: {
      subjectId: PersonId,
      interactionId: InteractionId,
      occurredOn: IsoDate,
      basis: ObserverBasis,
      mode: ObservationMode,
      skillIds: Schema.Array(SkillId),
    },
    events: [ObservationStarted],
    rejects: [AlreadyExists, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Observer starts a new feedback draft for a colleague.' },
) {}

export class SaveObservationDraft extends Domain.Command(
  'SaveObservationDraft',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: {
      mode: ObservationMode,
      ratedSkillCount: Schema.Int,
      narrativeLength: Schema.Int,
    },
    events: [ObservationDraftSaved],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Observer saves an in-progress observation draft.' },
) {}

export class SignObservation extends Domain.Command(
  'SignObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: {
      mode: ObservationMode,
      ratings: Schema.Array(SkillRatingFact),
      narrativeSaw: Schema.String,
      narrativeNext: Schema.String,
      contentDigest: Schema.String,
    },
    events: [ObservationSigned],
    rejects: [InvalidTransition, UnauthorizedActor, PrivacyViolation, InvalidDomainInput],
  },
  { description: 'Observer signs an observation; the sole event that posts skill credit.' },
) {}

export class ReturnObservation extends Domain.Command(
  'ReturnObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: { noteLength: Schema.Int },
    events: [ObservationReturned],
    rejects: [InvalidTransition, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Observer returns a request with a short clarifying note.' },
) {}

export class ResubmitObservation extends Domain.Command(
  'ResubmitObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: {},
    events: [ObservationResubmitted],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Requester resubmits a returned observation request.' },
) {}

export class AcknowledgeObservation extends Domain.Command(
  'AcknowledgeObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: {},
    events: [ObservationAcknowledged],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Subject acknowledges a signed observation.' },
) {}

export class RequestObservationReview extends Domain.Command(
  'RequestObservationReview',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: { noteLength: Schema.Int },
    events: [ObservationReviewRequested],
    rejects: [InvalidTransition, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Subject requests a compliance review of a signed observation.' },
) {}

export class UpholdObservation extends Domain.Command(
  'UpholdObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: {},
    events: [ObservationUpheld],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Compliance reviewer upholds an observation under review.' },
) {}

export class VoidObservation extends Domain.Command(
  'VoidObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: { noteLength: Schema.Int },
    events: [ObservationVoided],
    rejects: [InvalidTransition, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Void a signed/reviewed observation and trigger credit reversal.' },
) {}

export class DeclineObservation extends Domain.Command(
  'DeclineObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: { noteLength: Schema.Int },
    events: [ObservationDeclined],
    rejects: [InvalidTransition, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Observer declines an open observation request.' },
) {}

export class WithdrawObservation extends Domain.Command(
  'WithdrawObservation',
  {
    target: ObservationId,
    middleware: [CoachingSession],
    input: {},
    events: [ObservationWithdrawn],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Requester or observer withdraws an unsigned observation.' },
) {}

export class ExpireObservation extends Domain.Command(
  'ExpireObservation',
  {
    target: ObservationId,
    input: {},
    events: [ObservationExpired],
    rejects: [],
  },
  { description: 'System sweep expires a stale unsigned observation.' },
) {}
