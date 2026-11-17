import { Conflict, Forbidden, InvalidTransition } from '@repo/api';
import type { Lifecycle } from '@repo/domain';
import { Effect } from 'effect';
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
    message: `This ${entity} changed while you were working on it. Reload to see the latest version.`,
  });

/** Fails with Conflict when an optimistic update touched no rows. */
export const requireUpdated =
  <A>(entity: string) =>
  (rows: ReadonlyArray<A>) =>
    rows.length === 0 ? Effect.fail(staleWrite(entity)) : Effect.succeed(rows[0] as A);
