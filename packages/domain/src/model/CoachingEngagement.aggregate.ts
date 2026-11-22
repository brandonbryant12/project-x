import * as Domain from '@alchemy.run/domain';
import { Effect, Schema } from 'effect';
import { EngagementId, PersonId, TenantId } from '../ids.ts';
import { EngagementLifecycle, type EngagementEvent } from '../lifecycles/engagement.ts';
import { CoachingActor, CoachingSession } from './CoachingActor.context.ts';
import {
  AlreadyExists,
  InvalidDomainInput,
  InvalidTransition,
  UnauthorizedActor,
} from './Shared.ts';

export class EngagementProposed extends Domain.Event('EngagementProposed', {
  tenantId: TenantId,
  coachId: PersonId,
  coacheeId: PersonId,
}) {}

export class EngagementAccepted extends Domain.Event('EngagementAccepted', {}) {}
export class EngagementDeclined extends Domain.Event('EngagementDeclined', {}) {}
export class EngagementPaused extends Domain.Event('EngagementPaused', {}) {}
export class EngagementResumed extends Domain.Event('EngagementResumed', {}) {}
export class EngagementEnded extends Domain.Event('EngagementEnded', {}) {}
export class EngagementWithdrawn extends Domain.Event('EngagementWithdrawn', {}) {}
export class EngagementExpired extends Domain.Event('EngagementExpired', {}) {}

export class ProposeEngagement extends Domain.Command(
  'ProposeEngagement',
  {
    target: EngagementId,
    middleware: [CoachingSession],
    input: { coachId: PersonId, coacheeId: PersonId },
    events: [EngagementProposed],
    rejects: [AlreadyExists, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Propose a 1:1 coaching engagement between a coach and advisor.' },
) {}

export class AcceptEngagement extends Domain.Command(
  'AcceptEngagement',
  {
    target: EngagementId,
    middleware: [CoachingSession],
    input: { coachGrantActive: Schema.Boolean },
    events: [EngagementAccepted],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Accept a proposed coaching engagement.' },
) {}

export class DeclineEngagement extends Domain.Command(
  'DeclineEngagement',
  {
    target: EngagementId,
    middleware: [CoachingSession],
    input: {},
    events: [EngagementDeclined],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Decline a proposed coaching engagement.' },
) {}

export class PauseEngagement extends Domain.Command(
  'PauseEngagement',
  {
    target: EngagementId,
    middleware: [CoachingSession],
    input: {},
    events: [EngagementPaused],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Pause an active coaching engagement.' },
) {}

export class ResumeEngagement extends Domain.Command(
  'ResumeEngagement',
  {
    target: EngagementId,
    middleware: [CoachingSession],
    input: { coachGrantActive: Schema.Boolean },
    events: [EngagementResumed],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Resume a paused coaching engagement.' },
) {}

export class EndEngagement extends Domain.Command(
  'EndEngagement',
  {
    target: EngagementId,
    middleware: [CoachingSession],
    input: {},
    events: [EngagementEnded],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'End an active or paused coaching engagement.' },
) {}

export class WithdrawEngagement extends Domain.Command(
  'WithdrawEngagement',
  {
    target: EngagementId,
    middleware: [CoachingSession],
    input: {},
    events: [EngagementWithdrawn],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Withdraw a proposed engagement before acceptance.' },
) {}

export class ExpireEngagement extends Domain.Command(
  'ExpireEngagement',
  {
    target: EngagementId,
    input: {},
    events: [EngagementExpired],
    rejects: [],
  },
  { description: 'System sweep expires an unanswered engagement proposal.' },
) {}

export const EngagementState = Schema.Union([
  Schema.TaggedStruct('Uncreated', {}),
  Schema.TaggedStruct('Created', {
    tenantId: TenantId,
    coachId: PersonId,
    coacheeId: PersonId,
    status: EngagementLifecycle.Status,
  }),
]);
export type EngagementState = typeof EngagementState.Type;

const checkEngagement = (
  state: EngagementState,
  event: EngagementEvent,
  coachGrantActive = true,
): Extract<EngagementState, { readonly _tag: 'Created' }> | InvalidTransition => {
  if (state._tag !== 'Created') {
    return new InvalidTransition({
      entity: 'CoachingEngagement',
      from: 'uncreated',
      event: event.type,
      reason: 'Engagement does not exist.',
    });
  }
  const next = EngagementLifecycle.next(state.status, { coachGrantActive }, event);
  if (!next) {
    return new InvalidTransition({
      entity: 'CoachingEngagement',
      from: state.status,
      event: event.type,
      reason: `Cannot ${event.type} an engagement in state ${state.status}.`,
    });
  }
  return state;
};

export class CoachingEngagement extends Domain.Aggregate(
  'CoachingEngagement',
  {
    id: EngagementId,
    state: EngagementState,
    initial: { _tag: 'Uncreated' },
    commands: [
      ProposeEngagement,
      AcceptEngagement,
      DeclineEngagement,
      PauseEngagement,
      ResumeEngagement,
      EndEngagement,
      WithdrawEngagement,
      ExpireEngagement,
    ],
    decide: {
      ProposeEngagement: Effect.fn(function* (state, cmd, ctx) {
        if (state._tag !== 'Uncreated') {
          return yield* new AlreadyExists({ entity: 'CoachingEngagement', id: ctx.id });
        }
        const actor = yield* CoachingActor;
        if (actor.kind !== 'person' || !actor.personId) {
          return yield* new UnauthorizedActor({
            action: 'ProposeEngagement',
            reason: 'A signed-in person is required.',
          });
        }
        if (cmd.coachId === cmd.coacheeId) {
          return yield* new InvalidDomainInput({
            field: 'coachId',
            reason: 'A person cannot coach themselves.',
          });
        }
        return [
          new EngagementProposed({
            tenantId: actor.tenantId,
            coachId: cmd.coachId,
            coacheeId: cmd.coacheeId,
          }),
        ];
      }),
      AcceptEngagement: Effect.fn(function* (state, cmd) {
        const checked = checkEngagement(state, { type: 'ACCEPT' }, cmd.coachGrantActive);
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (actor.personId !== checked.coachId && actor.personId !== checked.coacheeId) {
          return yield* new UnauthorizedActor({
            action: 'AcceptEngagement',
            reason: 'Only the coach or coachee can accept.',
          });
        }
        return [new EngagementAccepted({})];
      }),
      DeclineEngagement: Effect.fn(function* (state) {
        const checked = checkEngagement(state, { type: 'DECLINE' });
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (actor.personId !== checked.coachId && actor.personId !== checked.coacheeId) {
          return yield* new UnauthorizedActor({
            action: 'DeclineEngagement',
            reason: 'Only the coach or coachee can decline.',
          });
        }
        return [new EngagementDeclined({})];
      }),
      PauseEngagement: Effect.fn(function* (state) {
        const checked = checkEngagement(state, { type: 'PAUSE' });
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (
          actor.personId !== checked.coachId &&
          actor.personId !== checked.coacheeId &&
          !actor.grants.includes('tenant_admin')
        ) {
          return yield* new UnauthorizedActor({
            action: 'PauseEngagement',
            reason: 'Only a participant or tenant admin can pause.',
          });
        }
        return [new EngagementPaused({})];
      }),
      ResumeEngagement: Effect.fn(function* (state, cmd) {
        const checked = checkEngagement(state, { type: 'RESUME' }, cmd.coachGrantActive);
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (actor.personId !== checked.coachId && actor.personId !== checked.coacheeId) {
          return yield* new UnauthorizedActor({
            action: 'ResumeEngagement',
            reason: 'Only a participant can resume.',
          });
        }
        return [new EngagementResumed({})];
      }),
      EndEngagement: Effect.fn(function* (state) {
        const checked = checkEngagement(state, { type: 'END' });
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (
          actor.personId !== checked.coachId &&
          actor.personId !== checked.coacheeId &&
          !actor.grants.includes('tenant_admin')
        ) {
          return yield* new UnauthorizedActor({
            action: 'EndEngagement',
            reason: 'Only a participant or tenant admin can end an engagement.',
          });
        }
        return [new EngagementEnded({})];
      }),
      WithdrawEngagement: Effect.fn(function* (state) {
        const checked = checkEngagement(state, { type: 'WITHDRAW' });
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (actor.personId !== checked.coachId && actor.personId !== checked.coacheeId) {
          return yield* new UnauthorizedActor({
            action: 'WithdrawEngagement',
            reason: 'Only a participant can withdraw.',
          });
        }
        return [new EngagementWithdrawn({})];
      }),
      ExpireEngagement: (state) => {
        if (state._tag !== 'Created') return [];
        const next = EngagementLifecycle.next(
          state.status,
          { coachGrantActive: false },
          { type: 'EXPIRE' },
        );
        return next ? [new EngagementExpired({})] : [];
      },
    },
    evolve: {
      EngagementProposed: (_state, e) => ({
        _tag: 'Created' as const,
        tenantId: e.tenantId,
        coachId: e.coachId,
        coacheeId: e.coacheeId,
        status: 'proposed' as const,
      }),
      EngagementAccepted: (state) =>
        state._tag === 'Created' ? { ...state, status: 'active' as const } : state,
      EngagementDeclined: (state) =>
        state._tag === 'Created' ? { ...state, status: 'declined' as const } : state,
      EngagementPaused: (state) =>
        state._tag === 'Created' ? { ...state, status: 'paused' as const } : state,
      EngagementResumed: (state) =>
        state._tag === 'Created' ? { ...state, status: 'active' as const } : state,
      EngagementEnded: (state) =>
        state._tag === 'Created' ? { ...state, status: 'ended' as const } : state,
      EngagementWithdrawn: (state) =>
        state._tag === 'Created' ? { ...state, status: 'withdrawn' as const } : state,
      EngagementExpired: (state) =>
        state._tag === 'Created' ? { ...state, status: 'expired' as const } : state,
    },
  },
  { description: '1:1 coaching engagement relationship lifecycle.' },
) {}
