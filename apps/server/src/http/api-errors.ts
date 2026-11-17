import type { ApiError } from '@repo/api';
import { Effect, Predicate } from 'effect';

const API_ERROR_TAGS = new Set([
  'Unauthorized',
  'Forbidden',
  'NotFound',
  'InvalidTransition',
  'Conflict',
  'Unprocessable',
]);

const isApiError = (error: unknown): error is ApiError =>
  Predicate.hasProperty(error, '_tag') &&
  typeof error._tag === 'string' &&
  API_ERROR_TAGS.has(error._tag);

/**
 * Handler boundary: declared API errors pass through to the client; anything
 * else (SQL, decoding, invariants) becomes a defect → 500, logged with cause.
 */
export const apiErrorsOnly = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Extract<E, ApiError>, R> =>
  Effect.catch(effect, (error) =>
    isApiError(error) ? Effect.fail(error as Extract<E, ApiError>) : Effect.die(error),
  );
