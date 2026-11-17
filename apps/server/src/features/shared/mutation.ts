import { Conflict, Forbidden, InvalidTransition } from '@repo/api';
import type { Lifecycle } from '@repo/domain';
import { Cause, Effect } from 'effect';
import { isSqlErrorReason } from 'effect/sql/SqlError';
import type { AnyStateMachine, ContextFrom, EventFromLogic } from 'xstate';

/**
 * Decide a lifecycle event for an actor (ADR 0005):
 *  - the policy says *who* may send it (`permitted`)
 *  - the machine says whether the current state and facts accept it
 * A policy refusal is Forbidden; a lifecycle refusal is InvalidTransition with
 * a human explanation.
 */
export const decide = <M extends AnyStateMachine, S extends string, E extends string>(input: {
  readonly lifecycle: Lifecycle<M, S, E & EventFromLogic<M>['type']>;
  readonly from: S;
  readonly facts: ContextFrom<M>;
  readonly event: EventFromLogic<M>;
  readonly permitted: boolean;
  readonly forbiddenMessage?: string;
  readonly explain?: string;
}): Effect.Effect<S, Forbidden | InvalidTransition> => {
  if (!input.permitted) {
    return Effect.fail(
      new Forbidden({ message: input.forbiddenMessage ?? 'You cannot do that here.' }),
    );
  }
  const next = input.lifecycle.next(input.from, input.facts, input.event);
  return next === null
    ? Effect.fail(
        new InvalidTransition({
          entity: input.lifecycle.name,
          from: input.from,
          event: input.event.type,
          message:
            input.explain ??
            `This ${input.lifecycle.name} is ${input.from.replaceAll('_', ' ')}; that action is not available.`,
        }),
      )
    : Effect.succeed(next);
};

/** Optimistic-concurrency guard: the UPDATE … WHERE version = $v matched no row. */
export const staleWrite = (entity: string) =>
  new Conflict({
    message: `This ${entity} changed since you opened it. Check the latest version, then try again.`,
  });

/**
 * The version a person loaded must still be current: a write never applies to
 * a row changed since they saw it (agreeing, confirming or overwriting).
 */
export const requireVersion = (entity: string, loaded: number, current: number) =>
  loaded === current ? Effect.void : Effect.fail(staleWrite(entity));

/** Fails with Conflict when an optimistic update touched no rows. */
export const requireUpdated =
  <A>(entity: string) =>
  (rows: ReadonlyArray<A>) =>
    rows.length === 0 ? Effect.fail(staleWrite(entity)) : Effect.succeed(rows[0] as A);

/**
 * Whether a failed write broke the named unique index. Both drivers
 * (`@effect/sql-pg`, PGlite) classify SQLSTATE 23505 as a `UniqueViolation`
 * reason carrying the index name; Drizzle's query error holds it inside an
 * Effect `Cause`, so the error's causes are searched a few links deep.
 */
export const isUniqueViolation =
  (constraint: string) =>
  (error: unknown): boolean => {
    const search = (value: unknown, depth: number): boolean => {
      if (depth > 4 || typeof value !== 'object' || value === null) return false;
      if (isSqlErrorReason(value)) {
        return value._tag === 'UniqueViolation' && value.constraint === constraint;
      }
      if (Cause.isCause(value)) {
        return value.reasons.some(
          (reason) =>
            (Cause.isFailReason(reason) && search(reason.error, depth + 1)) ||
            (Cause.isDieReason(reason) && search(reason.defect, depth + 1)),
        );
      }
      return search((value as { readonly cause?: unknown }).cause, depth + 1);
    };
    return search(error, 0);
  };
