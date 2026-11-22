import * as Domain from '@alchemy.run/domain';
import { Effect, Schema } from 'effect';
import { InteractionId, IsoDate, ObservationId, PersonId, SkillId, TenantId } from '../ids.ts';
import {
  MIN_NARRATIVE_LENGTH,
  ObservationLifecycle,
  type ObservationEvent,
  type ObservationFacts,
  type ObservationStatus,
} from '../lifecycles/observation.ts';
import { screenLocally } from '../privacy.ts';
import { MAX_SKILLS_PER_OBSERVATION } from '../scoring/policy.ts';
import { ObservationMode, ObserverBasis } from '../vocabulary.ts';
import { CoachingActor, type ActorPayload } from './CoachingActor.context.ts';
import {
  AcknowledgeObservation,
  DeclineObservation,
  ExpireObservation,
  ObservationAcknowledged,
  ObservationDeclined,
  ObservationDraftSaved,
  ObservationExpired,
  ObservationRequested,
  ObservationResubmitted,
  ObservationReturned,
  ObservationReviewRequested,
  ObservationSigned,
  ObservationStarted,
  ObservationUpheld,
  ObservationVoided,
  ObservationWithdrawn,
  RequestObservation,
  RequestObservationReview,
  ResubmitObservation,
  ReturnObservation,
  SaveObservationDraft,
  SignObservation,
  StartObservation,
  UpholdObservation,
  VoidObservation,
  WithdrawObservation,
} from './Observation.commands.ts';
import {
  AlreadyExists,
  InvalidDomainInput,
  InvalidTransition,
  PrivacyViolation,
  SkillRatingFact,
  UnauthorizedActor,
} from './Shared.ts';

export const ObservationActiveState = Schema.TaggedStruct('Active', {
  status: ObservationLifecycle.Status,
  tenantId: TenantId,
  subjectId: PersonId,
  observerId: PersonId,
  requestedById: PersonId,
  interactionId: InteractionId,
  occurredOn: IsoDate,
  basis: ObserverBasis,
  mode: ObservationMode,
  acknowledged: Schema.Boolean,
  creditedSkillIds: Schema.Array(SkillId),
  ratings: Schema.Array(SkillRatingFact),
});
export type ObservationActiveState = typeof ObservationActiveState.Type;

export const ObservationState = Schema.Union([
  Schema.TaggedStruct('Uncreated', {}),
  ObservationActiveState,
]);
export type ObservationState = typeof ObservationState.Type;

const requireActive = (
  state: ObservationState,
  event: string,
): ObservationActiveState | InvalidTransition =>
  state._tag === 'Active'
    ? state
    : new InvalidTransition({
        entity: 'Observation',
        from: 'uncreated',
        event,
        reason: 'Observation does not exist yet.',
      });

const checkLifecycle = (
  state: ObservationActiveState,
  event: ObservationEvent,
  facts: ObservationFacts,
): ObservationStatus | InvalidTransition => {
  const next = ObservationLifecycle.next(state.status, facts, event);
  return (
    next ??
    new InvalidTransition({
      entity: 'Observation',
      from: state.status,
      event: event.type,
      reason: `Cannot ${event.type} an observation in state ${state.status}.`,
    })
  );
};

const requirePerson = (actor: ActorPayload, action: string): PersonId | UnauthorizedActor =>
  actor.kind === 'person' && actor.personId
    ? actor.personId
    : new UnauthorizedActor({ action, reason: 'A human actor is required for this action.' });

const requireNote = (noteLength: number): InvalidDomainInput | null =>
  noteLength < 3
    ? new InvalidDomainInput({
        field: 'note',
        reason: 'Add a short note (at least 3 characters) explaining why.',
      })
    : null;

const emptyFacts = (acknowledged = false): ObservationFacts => ({
  ratingsComplete: false,
  narrativeLength: 0,
  privacyHold: false,
  acknowledged,
});

export class Observation extends Domain.Aggregate(
  'Observation',
  {
    id: ObservationId,
    state: ObservationState,
    initial: { _tag: 'Uncreated' },
    commands: [
      RequestObservation,
      StartObservation,
      SaveObservationDraft,
      SignObservation,
      ReturnObservation,
      ResubmitObservation,
      AcknowledgeObservation,
      RequestObservationReview,
      UpholdObservation,
      VoidObservation,
      DeclineObservation,
      WithdrawObservation,
      ExpireObservation,
    ],
    decide: {
      RequestObservation: Effect.fn(function* (state, cmd, ctx) {
        if (state._tag !== 'Uncreated') {
          return yield* new AlreadyExists({ entity: 'Observation', id: ctx.id });
        }
        const actor = yield* CoachingActor;
        const personId = requirePerson(actor, 'RequestObservation');
        if (personId instanceof UnauthorizedActor) return yield* personId;
        if (cmd.subjectId === cmd.observerId) {
          return yield* new InvalidDomainInput({
            field: 'observerId',
            reason: 'An advisor cannot observe themselves.',
          });
        }
        return [
          new ObservationRequested({
            tenantId: actor.tenantId,
            subjectId: cmd.subjectId,
            observerId: cmd.observerId,
            requestedById: personId,
            interactionId: cmd.interactionId,
            occurredOn: cmd.occurredOn,
            basis: cmd.basis,
            mode: cmd.mode,
            requestedSkillIds: cmd.skillIds,
          }),
        ];
      }),
      StartObservation: Effect.fn(function* (state, cmd, ctx) {
        if (state._tag !== 'Uncreated') {
          return yield* new AlreadyExists({ entity: 'Observation', id: ctx.id });
        }
        const actor = yield* CoachingActor;
        const personId = requirePerson(actor, 'StartObservation');
        if (personId instanceof UnauthorizedActor) return yield* personId;
        if (cmd.subjectId === personId) {
          return yield* new InvalidDomainInput({
            field: 'subjectId',
            reason: 'You cannot observe yourself.',
          });
        }
        return [
          new ObservationStarted({
            tenantId: actor.tenantId,
            subjectId: cmd.subjectId,
            observerId: personId,
            interactionId: cmd.interactionId,
            occurredOn: cmd.occurredOn,
            basis: cmd.basis,
            mode: cmd.mode,
            skillIds: cmd.skillIds,
          }),
        ];
      }),
      SaveObservationDraft: Effect.fn(function* (state, cmd) {
        const active = requireActive(state, 'SAVE_DRAFT');
        if (active instanceof InvalidTransition) return yield* active;
        const actor = yield* CoachingActor;
        if (actor.personId !== active.observerId) {
          return yield* new UnauthorizedActor({
            action: 'SaveObservationDraft',
            reason: 'Only the assigned observer can save a draft.',
          });
        }
        const next = checkLifecycle(active, { type: 'SAVE_DRAFT' }, emptyFacts());
        if (next instanceof InvalidTransition) return yield* next;
        return [
          new ObservationDraftSaved({
            mode: cmd.mode,
            ratedSkillCount: cmd.ratedSkillCount,
            narrativeLength: cmd.narrativeLength,
          }),
        ];
      }),
      SignObservation: Effect.fn(function* (state, cmd) {
        const active = requireActive(state, 'SIGN');
        if (active instanceof InvalidTransition) return yield* active;
        const actor = yield* CoachingActor;
        if (actor.kind !== 'person' || actor.personId !== active.observerId) {
          return yield* new UnauthorizedActor({
            action: 'SignObservation',
            reason: 'Only the assigned human observer can sign an observation.',
          });
        }
        const uniqueSkills = new Set(cmd.ratings.map((r) => r.skillId));
        if (
          cmd.ratings.length === 0 ||
          cmd.ratings.length > MAX_SKILLS_PER_OBSERVATION ||
          uniqueSkills.size !== cmd.ratings.length
        ) {
          return yield* new InvalidDomainInput({
            field: 'ratings',
            reason: 'Rate between 1 and 3 distinct skills.',
          });
        }
        const screen = screenLocally(`${cmd.narrativeSaw}\n${cmd.narrativeNext}`);
        if (screen.held) return yield* new PrivacyViolation({ reasons: screen.reasons });
        const trimmedLen = cmd.narrativeSaw.trim().length;
        if (trimmedLen < MIN_NARRATIVE_LENGTH) {
          return yield* new InvalidDomainInput({
            field: 'narrativeSaw',
            reason: `Write at least ${MIN_NARRATIVE_LENGTH} characters about what you saw.`,
          });
        }
        const next = checkLifecycle(
          active,
          { type: 'SIGN' },
          {
            ratingsComplete: true,
            narrativeLength: trimmedLen,
            privacyHold: screen.held,
            acknowledged: active.acknowledged,
          },
        );
        if (next instanceof InvalidTransition) return yield* next;
        return [
          new ObservationSigned({
            tenantId: active.tenantId,
            subjectId: active.subjectId,
            observerId: active.observerId,
            interactionId: active.interactionId,
            occurredOn: active.occurredOn,
            basis: active.basis,
            mode: cmd.mode,
            ratings: cmd.ratings,
            contentDigest: cmd.contentDigest,
          }),
        ];
      }),
      ReturnObservation: Effect.fn(function* (state, cmd) {
        const active = requireActive(state, 'RETURN');
        if (active instanceof InvalidTransition) return yield* active;
        const noteErr = requireNote(cmd.noteLength);
        if (noteErr) return yield* noteErr;
        const actor = yield* CoachingActor;
        if (actor.personId !== active.observerId) {
          return yield* new UnauthorizedActor({
            action: 'ReturnObservation',
            reason: 'Only the observer can return a request.',
          });
        }
        const next = checkLifecycle(active, { type: 'RETURN' }, emptyFacts());
        if (next instanceof InvalidTransition) return yield* next;
        return [
          new ObservationReturned({
            tenantId: active.tenantId,
            requestedById: active.requestedById,
            returnedById: active.observerId,
          }),
        ];
      }),
      ResubmitObservation: Effect.fn(function* (state) {
        const active = requireActive(state, 'RESUBMIT');
        if (active instanceof InvalidTransition) return yield* active;
        const actor = yield* CoachingActor;
        if (actor.personId !== active.requestedById && actor.personId !== active.subjectId) {
          return yield* new UnauthorizedActor({
            action: 'ResubmitObservation',
            reason: 'Only the requester or subject can resubmit.',
          });
        }
        const next = checkLifecycle(active, { type: 'RESUBMIT' }, emptyFacts());
        if (next instanceof InvalidTransition) return yield* next;
        return [new ObservationResubmitted({ resubmittedById: actor.personId })];
      }),
      AcknowledgeObservation: Effect.fn(function* (state) {
        const active = requireActive(state, 'ACKNOWLEDGE');
        if (active instanceof InvalidTransition) return yield* active;
        const actor = yield* CoachingActor;
        if (actor.personId !== active.subjectId) {
          return yield* new UnauthorizedActor({
            action: 'AcknowledgeObservation',
            reason: 'Only the subject can acknowledge an observation.',
          });
        }
        const next = checkLifecycle(
          active,
          { type: 'ACKNOWLEDGE' },
          emptyFacts(active.acknowledged),
        );
        if (next instanceof InvalidTransition) return yield* next;
        return [new ObservationAcknowledged({ subjectId: active.subjectId })];
      }),
      RequestObservationReview: Effect.fn(function* (state, cmd) {
        const active = requireActive(state, 'REQUEST_REVIEW');
        if (active instanceof InvalidTransition) return yield* active;
        const noteErr = requireNote(cmd.noteLength);
        if (noteErr) return yield* noteErr;
        const actor = yield* CoachingActor;
        if (actor.personId !== active.subjectId) {
          return yield* new UnauthorizedActor({
            action: 'RequestObservationReview',
            reason: 'Only the subject can request a review.',
          });
        }
        const next = checkLifecycle(
          active,
          { type: 'REQUEST_REVIEW' },
          emptyFacts(active.acknowledged),
        );
        if (next instanceof InvalidTransition) return yield* next;
        return [new ObservationReviewRequested({ requestedById: active.subjectId })];
      }),
      UpholdObservation: Effect.fn(function* (state) {
        const active = requireActive(state, 'UPHOLD');
        if (active instanceof InvalidTransition) return yield* active;
        const actor = yield* CoachingActor;
        const personId = requirePerson(actor, 'UpholdObservation');
        if (personId instanceof UnauthorizedActor) return yield* personId;
        if (!actor.grants.includes('compliance_reviewer')) {
          return yield* new UnauthorizedActor({
            action: 'UpholdObservation',
            reason: 'Only compliance reviewers can uphold an observation under review.',
          });
        }
        const next = checkLifecycle(active, { type: 'UPHOLD' }, emptyFacts(active.acknowledged));
        if (next instanceof InvalidTransition) return yield* next;
        return [new ObservationUpheld({ reviewerId: personId })];
      }),
      VoidObservation: Effect.fn(function* (state, cmd) {
        const active = requireActive(state, 'VOID');
        if (active instanceof InvalidTransition) return yield* active;
        const noteErr = requireNote(cmd.noteLength);
        if (noteErr) return yield* noteErr;
        const actor = yield* CoachingActor;
        const personId = requirePerson(actor, 'VoidObservation');
        if (personId instanceof UnauthorizedActor) return yield* personId;
        const canVoid =
          actor.grants.includes('compliance_reviewer') ||
          actor.grants.includes('tenant_admin') ||
          personId === active.observerId;
        if (!canVoid) {
          return yield* new UnauthorizedActor({
            action: 'VoidObservation',
            reason: 'Only the observer, a compliance reviewer, or a tenant admin can void.',
          });
        }
        const next = checkLifecycle(active, { type: 'VOID' }, emptyFacts(active.acknowledged));
        if (next instanceof InvalidTransition) return yield* next;
        return [
          new ObservationVoided({
            tenantId: active.tenantId,
            subjectId: active.subjectId,
            observerId: active.observerId,
            creditedSkillIds: active.creditedSkillIds,
            voidedById: personId,
          }),
        ];
      }),
      DeclineObservation: Effect.fn(function* (state, cmd) {
        const active = requireActive(state, 'DECLINE');
        if (active instanceof InvalidTransition) return yield* active;
        const noteErr = requireNote(cmd.noteLength);
        if (noteErr) return yield* noteErr;
        const actor = yield* CoachingActor;
        if (actor.personId !== active.observerId) {
          return yield* new UnauthorizedActor({
            action: 'DeclineObservation',
            reason: 'Only the assigned observer can decline.',
          });
        }
        const next = checkLifecycle(active, { type: 'DECLINE' }, emptyFacts());
        if (next instanceof InvalidTransition) return yield* next;
        return [new ObservationDeclined({ declinedById: active.observerId })];
      }),
      WithdrawObservation: Effect.fn(function* (state) {
        const active = requireActive(state, 'WITHDRAW');
        if (active instanceof InvalidTransition) return yield* active;
        const actor = yield* CoachingActor;
        const personId = requirePerson(actor, 'WithdrawObservation');
        if (personId instanceof UnauthorizedActor) return yield* personId;
        if (personId !== active.requestedById && personId !== active.observerId) {
          return yield* new UnauthorizedActor({
            action: 'WithdrawObservation',
            reason: 'Only the requester or observer can withdraw an unsigned observation.',
          });
        }
        const next = checkLifecycle(active, { type: 'WITHDRAW' }, emptyFacts());
        if (next instanceof InvalidTransition) return yield* next;
        return [new ObservationWithdrawn({ withdrawnById: personId })];
      }),
      ExpireObservation: (state) => {
        if (state._tag !== 'Active') return [];
        const next = ObservationLifecycle.next(state.status, emptyFacts(), { type: 'EXPIRE' });
        return next ? [new ObservationExpired({})] : [];
      },
    },
    evolve: {
      ObservationRequested: (_state, e) => ({
        _tag: 'Active' as const,
        status: 'requested' as const,
        tenantId: e.tenantId,
        subjectId: e.subjectId,
        observerId: e.observerId,
        requestedById: e.requestedById,
        interactionId: e.interactionId,
        occurredOn: e.occurredOn,
        basis: e.basis,
        mode: e.mode,
        acknowledged: false,
        creditedSkillIds: [],
        ratings: [],
      }),
      ObservationStarted: (_state, e) => ({
        _tag: 'Active' as const,
        status: 'drafting' as const,
        tenantId: e.tenantId,
        subjectId: e.subjectId,
        observerId: e.observerId,
        requestedById: e.observerId,
        interactionId: e.interactionId,
        occurredOn: e.occurredOn,
        basis: e.basis,
        mode: e.mode,
        acknowledged: false,
        creditedSkillIds: [],
        ratings: [],
      }),
      ObservationDraftSaved: (state, e) =>
        state._tag === 'Active' ? { ...state, status: 'drafting' as const, mode: e.mode } : state,
      ObservationSigned: (state, e) =>
        state._tag === 'Active'
          ? {
              ...state,
              status: 'signed' as const,
              mode: e.mode,
              ratings: e.ratings,
              creditedSkillIds: e.ratings.filter((r) => r.credit).map((r) => r.skillId),
            }
          : state,
      ObservationReturned: (state) =>
        state._tag === 'Active' ? { ...state, status: 'returned' as const } : state,
      ObservationResubmitted: (state) =>
        state._tag === 'Active' ? { ...state, status: 'requested' as const } : state,
      ObservationAcknowledged: (state) =>
        state._tag === 'Active' ? { ...state, acknowledged: true } : state,
      ObservationReviewRequested: (state) =>
        state._tag === 'Active' ? { ...state, status: 'under_review' as const } : state,
      ObservationUpheld: (state) =>
        state._tag === 'Active' ? { ...state, status: 'signed' as const } : state,
      ObservationVoided: (state) =>
        state._tag === 'Active' ? { ...state, status: 'voided' as const } : state,
      ObservationDeclined: (state) =>
        state._tag === 'Active' ? { ...state, status: 'declined' as const } : state,
      ObservationWithdrawn: (state) =>
        state._tag === 'Active' ? { ...state, status: 'withdrawn' as const } : state,
      ObservationExpired: (state) =>
        state._tag === 'Active' ? { ...state, status: 'expired' as const } : state,
    },
  },
  { description: 'Observer-owned record of a demonstrated skill; SIGN is the sole credit source.' },
) {}
