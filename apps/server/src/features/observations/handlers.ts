import { Api, CurrentActor } from '@repo/api';
import type { ObservationId } from '@repo/domain';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import {
  requestObservation,
  requestQuickObservation,
  startObservation,
} from './use-cases/create.ts';
import { loadVisible } from './use-cases/shared.ts';
import { publishQuickObservation, saveDraft, signObservation } from './use-cases/sign.ts';
import { transitionObservation } from './use-cases/transition.ts';
import { buildInbox, buildObservationView, buildObservers, buildTargets } from './views.ts';

const view = (id: ObservationId) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    const row = yield* loadVisible(id);
    return yield* buildObservationView(actor, row);
  });

export const ObservationsHandlers = HttpApiBuilder.group(Api, 'observations', (handlers) =>
  handlers
    .handle('inbox', () =>
      Effect.gen(function* () {
        return yield* buildInbox(yield* CurrentActor);
      }).pipe(apiErrorsOnly),
    )
    .handle('targets', () =>
      Effect.gen(function* () {
        return yield* buildTargets(yield* CurrentActor);
      }).pipe(apiErrorsOnly),
    )
    .handle('observers', () =>
      Effect.gen(function* () {
        return yield* buildObservers(yield* CurrentActor);
      }).pipe(apiErrorsOnly),
    )
    .handle('get', ({ params }) => view(params.id).pipe(apiErrorsOnly))
    .handle('request', ({ payload }) =>
      requestObservation(payload).pipe(Effect.flatMap(view), apiErrorsOnly),
    )
    .handle('requestQuick', ({ payload }) =>
      requestQuickObservation(payload).pipe(Effect.flatMap(view), apiErrorsOnly),
    )
    .handle('start', ({ payload }) =>
      startObservation(payload).pipe(Effect.flatMap(view), apiErrorsOnly),
    )
    .handle('publishQuick', ({ payload }) =>
      publishQuickObservation(payload).pipe(Effect.flatMap(view), apiErrorsOnly),
    )
    .handle('saveDraft', ({ params, payload }) =>
      saveDraft(params.id, payload).pipe(Effect.andThen(view(params.id)), apiErrorsOnly),
    )
    .handle('sign', ({ params, payload }) =>
      signObservation(params.id, payload).pipe(Effect.andThen(view(params.id)), apiErrorsOnly),
    )
    .handle('transition', ({ params, payload }) =>
      transitionObservation(params.id, payload).pipe(
        Effect.andThen(view(params.id)),
        apiErrorsOnly,
      ),
    ),
);
