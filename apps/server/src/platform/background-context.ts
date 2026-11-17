import { Effect } from 'effect';
import { Background } from './background.ts';

/**
 * Schedules `effect` to run after the current request, carrying the current
 * services (Db, Decisions, ...) with it. Errors are logged, never surfaced.
 */
export const afterCommit = <R>(effect: Effect.Effect<unknown, unknown, R>) =>
  Effect.gen(function* () {
    const background = yield* Background;
    const context = yield* Effect.context<R>();
    yield* background.run(
      effect.pipe(
        Effect.asVoid,
        Effect.catchCause((cause) => Effect.logError('after-commit task failed', cause)),
        Effect.provide(context),
      ),
    );
  });
