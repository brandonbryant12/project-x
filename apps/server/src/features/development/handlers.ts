import { Api, CurrentActor, NotFound } from '@repo/api';
import type { PlanId } from '@repo/domain';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import {
  addActivity,
  activityEvent,
  createPlan,
  logInteraction,
  planEvent,
  reviseEvidence,
  setActivityValue,
  updateActivity,
  updatePlan,
} from './use-cases.ts';
import { confirmPlanReview, recordPlanReview } from './plan-review.ts';
import {
  buildDevelopmentView,
  buildInteractionView,
  buildPlanView,
  buildWorkTemplates,
  canViewDevelopmentOf,
} from './views.ts';

const planView = (planId: PlanId) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    return yield* buildPlanView(actor, planId);
  });

const interactionView = (id: Parameters<typeof buildInteractionView>[1]) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    const view = yield* buildInteractionView(actor, id);
    if (!view || !(yield* canViewDevelopmentOf(actor, view.owner.id))) {
      return yield* Effect.fail(new NotFound({ entity: 'interaction', id }));
    }
    return view;
  });

export const DevelopmentHandlers = HttpApiBuilder.group(Api, 'development', (handlers) =>
  handlers
    .handle('mine', () =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        return yield* buildDevelopmentView(actor, actor.personId);
      }).pipe(apiErrorsOnly),
    )
    .handle('workTemplates', () =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        return yield* buildWorkTemplates(actor.tenantId);
      }).pipe(apiErrorsOnly),
    )
    .handle('of', ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        if (!(yield* canViewDevelopmentOf(actor, params.id))) {
          return yield* Effect.fail(new NotFound({ entity: 'person', id: params.id }));
        }
        return yield* buildDevelopmentView(actor, params.id);
      }).pipe(apiErrorsOnly),
    )
    .handle('createPlan', ({ payload }) =>
      createPlan(payload).pipe(Effect.flatMap(planView), apiErrorsOnly),
    )
    .handle('updatePlan', ({ params, payload }) =>
      updatePlan(params.id, payload).pipe(Effect.andThen(planView(params.id)), apiErrorsOnly),
    )
    .handle('planEvent', ({ params, payload }) =>
      planEvent(params.id, payload.event).pipe(Effect.andThen(planView(params.id)), apiErrorsOnly),
    )
    .handle('addActivity', ({ params, payload }) =>
      addActivity(params.id, payload).pipe(Effect.andThen(planView(params.id)), apiErrorsOnly),
    )
    .handle('recordPlanReview', ({ params, payload }) =>
      recordPlanReview(params.id, payload).pipe(Effect.andThen(planView(params.id)), apiErrorsOnly),
    )
    .handle('confirmPlanReview', ({ params }) =>
      confirmPlanReview(params.id).pipe(Effect.andThen(planView(params.id)), apiErrorsOnly),
    )
    .handle('updateActivity', ({ params, payload }) =>
      updateActivity(params.id, payload).pipe(Effect.flatMap(planView), apiErrorsOnly),
    )
    .handle('setActivityValue', ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        const { planId, ownerId } = yield* setActivityValue(params.id, payload);
        return (yield* canViewDevelopmentOf(actor, ownerId)) ? yield* planView(planId) : null;
      }).pipe(apiErrorsOnly),
    )
    .handle('activityEvent', ({ params, payload }) =>
      Effect.gen(function* () {
        const planId = yield* activityEvent(params.id, payload.event);
        if (!planId) return yield* Effect.fail(new NotFound({ entity: 'plan', id: 'none' }));
        return yield* planView(planId);
      }).pipe(apiErrorsOnly),
    )
    .handle('logInteraction', ({ payload }) =>
      logInteraction(payload).pipe(Effect.flatMap(interactionView), apiErrorsOnly),
    )
    .handle('interaction', ({ params }) => interactionView(params.id).pipe(apiErrorsOnly))
    .handle('reviseEvidence', ({ params, payload }) =>
      reviseEvidence(params.id, payload.body).pipe(
        Effect.andThen(interactionView(params.id)),
        apiErrorsOnly,
      ),
    ),
);
