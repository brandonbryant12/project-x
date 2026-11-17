import { Context, Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { Background } from './background.ts';

/**
 * Runs `effect` in the background once the surrounding SQL transaction
 * commits, carrying the current services (Db, Decisions, ...) with it. Called
 * inside a transaction, the work waits for COMMIT and is dropped if the
 * transaction rolls back; called outside one, it is scheduled at once. The
 * work never joins the transaction: its queries use their own connection.
 * Errors are logged, never surfaced.
 *
 * It is in-process: if the server stops before the work runs, the work is
 * lost. Anything that must happen needs a row written in the transaction or a
 * sweep that finds what was missed (the reflection screening sweep).
 */
export const afterCommit = <R>(effect: Effect.Effect<unknown, unknown, R>) =>
  Effect.gen(function* () {
    const background = yield* Background;
    const sql = yield* SqlClient.SqlClient;
    // Without the transaction: it has ended by the time the work runs.
    const context = Context.omit(sql.transactionService)(yield* Effect.context<R>());
    yield* sql.afterCommit(
      background.run(
        effect.pipe(
          Effect.asVoid,
          Effect.catchCause((cause) => Effect.logError('after-commit task failed', cause)),
          Effect.provide(context as Context.Context<R>),
        ),
      ),
    );
  });
