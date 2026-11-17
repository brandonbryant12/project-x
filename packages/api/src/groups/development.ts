import { ActivityId, InteractionId, PersonId, PlanId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Conflict, Forbidden, InvalidTransition, NotFound, Unprocessable } from '../errors.ts';
import {
  ActivityEventType,
  AddActivityInput,
  CreatePlanInput,
  DevelopmentView,
  InteractionView,
  LogInteractionInput,
  PlanEventType,
  PlanView,
  RecordPlanReviewInput,
  SetActivityValueInput,
  UpdateActivityInput,
  UpdatePlanInput,
  WorkTemplate,
} from '../models/index.ts';

const lifecycleErrors = [NotFound, Forbidden, InvalidTransition, Unprocessable, Conflict] as const;

export class DevelopmentGroup extends HttpApiGroup.make('development')
  .add(
    HttpApiEndpoint.get('mine', '/development', { success: DevelopmentView }),
    HttpApiEndpoint.get('workTemplates', '/development/templates', {
      success: Schema.Array(WorkTemplate),
    }),
    HttpApiEndpoint.get('of', '/people/:id/development', {
      params: { id: PersonId },
      success: DevelopmentView,
      error: NotFound,
    }),
    HttpApiEndpoint.post('createPlan', '/plans', {
      payload: CreatePlanInput,
      success: PlanView,
      error: [Conflict, Unprocessable],
    }),
    HttpApiEndpoint.patch('updatePlan', '/plans/:id', {
      params: { id: PlanId },
      payload: UpdatePlanInput,
      success: PlanView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.post('planEvent', '/plans/:id/events', {
      params: { id: PlanId },
      payload: Schema.Struct({ event: PlanEventType }),
      success: PlanView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.post('addActivity', '/plans/:id/activities', {
      params: { id: PlanId },
      payload: AddActivityInput,
      success: PlanView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.post('recordPlanReview', '/plans/:id/review', {
      params: { id: PlanId },
      payload: RecordPlanReviewInput,
      success: PlanView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.post('confirmPlanReview', '/plans/:id/review/confirm', {
      params: { id: PlanId },
      success: PlanView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.patch('updateActivity', '/activities/:id', {
      params: { id: ActivityId },
      payload: UpdateActivityInput,
      success: PlanView,
      error: lifecycleErrors,
    }),
    /** Null when the viewer may not see the plan: a program owner sees nothing per person. */
    HttpApiEndpoint.post('setActivityValue', '/activities/:id/value', {
      params: { id: ActivityId },
      payload: SetActivityValueInput,
      success: Schema.NullOr(PlanView),
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.post('activityEvent', '/activities/:id/events', {
      params: { id: ActivityId },
      payload: Schema.Struct({ event: ActivityEventType }),
      success: PlanView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.post('logInteraction', '/interactions', {
      payload: LogInteractionInput,
      success: InteractionView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.get('interaction', '/interactions/:id', {
      params: { id: InteractionId },
      success: InteractionView,
      error: NotFound,
    }),
    HttpApiEndpoint.post('reviseEvidence', '/interactions/:id/evidence', {
      params: { id: InteractionId },
      payload: Schema.Struct({ body: LogInteractionInput.fields.reflection }),
      success: InteractionView,
      error: lifecycleErrors,
    }),
  )
  .middleware(Authenticated) {}
