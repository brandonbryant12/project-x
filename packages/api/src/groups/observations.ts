import { ObservationId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Conflict, Forbidden, InvalidTransition, NotFound, Unprocessable } from '../errors.ts';
import {
  InboxView,
  ObservationDraftInput,
  ObservationTransitionInput,
  ObservationView,
  ObserveTarget,
  RequestObservationInput,
  StartObservationInput,
} from '../models/index.ts';

const lifecycleErrors = [NotFound, Forbidden, InvalidTransition, Unprocessable, Conflict] as const;

export class ObservationsGroup extends HttpApiGroup.make('observations')
  .add(
    HttpApiEndpoint.get('inbox', '/observations/inbox', { success: InboxView }),
    HttpApiEndpoint.get('targets', '/observations/targets', {
      success: Schema.Array(ObserveTarget),
    }),
    HttpApiEndpoint.get('get', '/observations/:id', {
      params: { id: ObservationId },
      success: ObservationView,
      error: NotFound,
    }),
    HttpApiEndpoint.post('request', '/observations', {
      payload: RequestObservationInput,
      success: ObservationView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.post('start', '/observations/start', {
      payload: StartObservationInput,
      success: ObservationView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.put('saveDraft', '/observations/:id/draft', {
      params: { id: ObservationId },
      payload: ObservationDraftInput,
      success: ObservationView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.post('sign', '/observations/:id/sign', {
      params: { id: ObservationId },
      payload: ObservationDraftInput,
      success: ObservationView,
      error: lifecycleErrors,
    }),
    HttpApiEndpoint.post('transition', '/observations/:id/events', {
      params: { id: ObservationId },
      payload: ObservationTransitionInput,
      success: ObservationView,
      error: lifecycleErrors,
    }),
  )
  .middleware(Authenticated) {}
