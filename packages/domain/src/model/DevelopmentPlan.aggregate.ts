import * as Domain from '@alchemy.run/domain';
import { Effect, Schema } from 'effect';
import { PersonId, PlanId, SkillId, TenantId } from '../ids.ts';
import { PlanLifecycle, type PlanEvent } from '../lifecycles/plan.ts';
import { CoachingActor, CoachingSession } from './CoachingActor.context.ts';
import {
  AlreadyExists,
  InvalidDomainInput,
  InvalidTransition,
  UnauthorizedActor,
} from './Shared.ts';

export class DevelopmentPlanCreated extends Domain.Event('DevelopmentPlanCreated', {
  tenantId: TenantId,
  ownerId: PersonId,
  focusSkillIds: Schema.Array(SkillId),
  status: Schema.Literals(['draft', 'active']),
}) {}

export class DevelopmentPlanProposed extends Domain.Event('DevelopmentPlanProposed', {
  tenantId: TenantId,
  ownerId: PersonId,
}) {}

export class DevelopmentPlanAgreed extends Domain.Event('DevelopmentPlanAgreed', {
  agreedById: PersonId,
}) {}

export class DevelopmentPlanEndorsed extends Domain.Event('DevelopmentPlanEndorsed', {
  endorsedById: PersonId,
}) {}

export class DevelopmentPlanCompleted extends Domain.Event('DevelopmentPlanCompleted', {}) {}

export class DevelopmentPlanCanceled extends Domain.Event('DevelopmentPlanCanceled', {}) {}

export class DevelopmentPlanExpired extends Domain.Event('DevelopmentPlanExpired', {}) {}

export class CreateDevelopmentPlan extends Domain.Command(
  'CreateDevelopmentPlan',
  {
    target: PlanId,
    middleware: [CoachingSession],
    input: {
      focusSkillIds: Schema.Array(SkillId),
      startActive: Schema.Boolean,
    },
    events: [DevelopmentPlanCreated],
    rejects: [AlreadyExists, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Create a focus skill development plan (instant-active or draft).' },
) {}

export class ProposeDevelopmentPlan extends Domain.Command(
  'ProposeDevelopmentPlan',
  {
    target: PlanId,
    middleware: [CoachingSession],
    input: {},
    events: [DevelopmentPlanProposed],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Propose a draft development plan for leader agreement.' },
) {}

export class AgreeDevelopmentPlan extends Domain.Command(
  'AgreeDevelopmentPlan',
  {
    target: PlanId,
    middleware: [CoachingSession],
    input: {},
    events: [DevelopmentPlanAgreed],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Leader agrees to a proposed development plan, activating it.' },
) {}

export class EndorseDevelopmentPlan extends Domain.Command(
  'EndorseDevelopmentPlan',
  {
    target: PlanId,
    middleware: [CoachingSession],
    input: {},
    events: [DevelopmentPlanEndorsed],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Coach endorses a proposed or active development plan.' },
) {}

export class CompleteDevelopmentPlan extends Domain.Command(
  'CompleteDevelopmentPlan',
  {
    target: PlanId,
    middleware: [CoachingSession],
    input: {},
    events: [DevelopmentPlanCompleted],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Mark an active development plan complete.' },
) {}

export class CancelDevelopmentPlan extends Domain.Command(
  'CancelDevelopmentPlan',
  {
    target: PlanId,
    middleware: [CoachingSession],
    input: {},
    events: [DevelopmentPlanCanceled],
    rejects: [InvalidTransition, UnauthorizedActor],
  },
  { description: 'Cancel an unfinished development plan.' },
) {}

export class ExpireDevelopmentPlan extends Domain.Command(
  'ExpireDevelopmentPlan',
  {
    target: PlanId,
    input: {},
    events: [DevelopmentPlanExpired],
    rejects: [],
  },
  { description: 'System sweep expires an overdue development plan.' },
) {}

export const DevelopmentPlanState = Schema.Union([
  Schema.TaggedStruct('Uncreated', {}),
  Schema.TaggedStruct('Created', {
    tenantId: TenantId,
    ownerId: PersonId,
    status: PlanLifecycle.Status,
    focusSkillIds: Schema.Array(SkillId),
    endorsed: Schema.Boolean,
  }),
]);
export type DevelopmentPlanState = typeof DevelopmentPlanState.Type;

const checkPlanTransition = (
  state: DevelopmentPlanState,
  event: PlanEvent,
): Extract<DevelopmentPlanState, { readonly _tag: 'Created' }> | InvalidTransition => {
  if (state._tag !== 'Created') {
    return new InvalidTransition({
      entity: 'DevelopmentPlan',
      from: 'uncreated',
      event: event.type,
      reason: 'Development plan does not exist.',
    });
  }
  const next = PlanLifecycle.next(
    state.status,
    { focusSkillCount: state.focusSkillIds.length, activityCount: 0, endorsed: state.endorsed },
    event,
  );
  if (!next) {
    return new InvalidTransition({
      entity: 'DevelopmentPlan',
      from: state.status,
      event: event.type,
      reason: `Cannot ${event.type} a plan in state ${state.status}.`,
    });
  }
  return state;
};

export class DevelopmentPlan extends Domain.Aggregate(
  'DevelopmentPlan',
  {
    id: PlanId,
    state: DevelopmentPlanState,
    initial: { _tag: 'Uncreated' },
    commands: [
      CreateDevelopmentPlan,
      ProposeDevelopmentPlan,
      AgreeDevelopmentPlan,
      EndorseDevelopmentPlan,
      CompleteDevelopmentPlan,
      CancelDevelopmentPlan,
      ExpireDevelopmentPlan,
    ],
    decide: {
      CreateDevelopmentPlan: Effect.fn(function* (state, cmd, ctx) {
        if (state._tag !== 'Uncreated') {
          return yield* new AlreadyExists({ entity: 'DevelopmentPlan', id: ctx.id });
        }
        const actor = yield* CoachingActor;
        if (actor.kind !== 'person' || !actor.personId) {
          return yield* new UnauthorizedActor({
            action: 'CreateDevelopmentPlan',
            reason: 'A signed-in person is required.',
          });
        }
        const unique = [...new Set(cmd.focusSkillIds)];
        if (unique.length < 1 || unique.length > 3) {
          return yield* new InvalidDomainInput({
            field: 'focusSkillIds',
            reason: 'Choose between 1 and 3 focus skills.',
          });
        }
        return [
          new DevelopmentPlanCreated({
            tenantId: actor.tenantId,
            ownerId: actor.personId,
            focusSkillIds: unique,
            status: cmd.startActive ? 'active' : 'draft',
          }),
        ];
      }),
      ProposeDevelopmentPlan: Effect.fn(function* (state) {
        const checked = checkPlanTransition(state, { type: 'PROPOSE' });
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (actor.personId !== checked.ownerId) {
          return yield* new UnauthorizedActor({
            action: 'ProposeDevelopmentPlan',
            reason: 'Only the plan owner can propose it.',
          });
        }
        return [
          new DevelopmentPlanProposed({ tenantId: checked.tenantId, ownerId: checked.ownerId }),
        ];
      }),
      AgreeDevelopmentPlan: Effect.fn(function* (state) {
        const checked = checkPlanTransition(state, { type: 'AGREE' });
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (!actor.personId || actor.personId === checked.ownerId) {
          return yield* new UnauthorizedActor({
            action: 'AgreeDevelopmentPlan',
            reason: 'A leader other than the plan owner must agree.',
          });
        }
        return [new DevelopmentPlanAgreed({ agreedById: actor.personId })];
      }),
      EndorseDevelopmentPlan: Effect.fn(function* (state) {
        const checked = checkPlanTransition(state, { type: 'ENDORSE' });
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (!actor.personId || !actor.grants.includes('coach')) {
          return yield* new UnauthorizedActor({
            action: 'EndorseDevelopmentPlan',
            reason: 'Only a coach can endorse a development plan.',
          });
        }
        return [new DevelopmentPlanEndorsed({ endorsedById: actor.personId })];
      }),
      CompleteDevelopmentPlan: Effect.fn(function* (state) {
        const checked = checkPlanTransition(state, { type: 'COMPLETE' });
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (actor.personId !== checked.ownerId) {
          return yield* new UnauthorizedActor({
            action: 'CompleteDevelopmentPlan',
            reason: 'Only the plan owner can complete it.',
          });
        }
        return [new DevelopmentPlanCompleted({})];
      }),
      CancelDevelopmentPlan: Effect.fn(function* (state) {
        const checked = checkPlanTransition(state, { type: 'CANCEL' });
        if (checked instanceof InvalidTransition) return yield* checked;
        const actor = yield* CoachingActor;
        if (actor.personId !== checked.ownerId && !actor.grants.includes('tenant_admin')) {
          return yield* new UnauthorizedActor({
            action: 'CancelDevelopmentPlan',
            reason: 'Only the plan owner or a tenant admin can cancel.',
          });
        }
        return [new DevelopmentPlanCanceled({})];
      }),
      ExpireDevelopmentPlan: (state) => {
        if (state._tag !== 'Created') return [];
        const next = PlanLifecycle.next(
          state.status,
          {
            focusSkillCount: state.focusSkillIds.length,
            activityCount: 0,
            endorsed: state.endorsed,
          },
          { type: 'EXPIRE' },
        );
        return next ? [new DevelopmentPlanExpired({})] : [];
      },
    },
    evolve: {
      DevelopmentPlanCreated: (_state, e) => ({
        _tag: 'Created' as const,
        tenantId: e.tenantId,
        ownerId: e.ownerId,
        status: e.status,
        focusSkillIds: e.focusSkillIds,
        endorsed: false,
      }),
      DevelopmentPlanProposed: (state) =>
        state._tag === 'Created' ? { ...state, status: 'proposed' as const } : state,
      DevelopmentPlanAgreed: (state) =>
        state._tag === 'Created' ? { ...state, status: 'active' as const } : state,
      DevelopmentPlanEndorsed: (state) =>
        state._tag === 'Created' ? { ...state, endorsed: true } : state,
      DevelopmentPlanCompleted: (state) =>
        state._tag === 'Created' ? { ...state, status: 'completed' as const } : state,
      DevelopmentPlanCanceled: (state) =>
        state._tag === 'Created' ? { ...state, status: 'canceled' as const } : state,
      DevelopmentPlanExpired: (state) =>
        state._tag === 'Created' ? { ...state, status: 'expired' as const } : state,
    },
  },
  { description: 'Advisor focus-skill development plan lifecycle.' },
) {}
