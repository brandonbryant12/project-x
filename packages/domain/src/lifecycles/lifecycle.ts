import { Schema } from 'effect';
import {
  transition,
  type AnyStateMachine,
  type ContextFrom,
  type EventFromLogic,
  type SnapshotFrom,
} from 'xstate';

/**
 * A lifecycle wraps one XState v5 machine with the pure helpers the server and UI
 * need. No actors are ever started: the persisted `status` column plus a context
 * of facts is resolved into a snapshot, and `transition` computes the next state.
 * See docs/adr/0005-explicit-lifecycles-with-xstate.md.
 */
export interface Lifecycle<
  M extends AnyStateMachine,
  S extends string,
  E extends EventFromLogic<M>['type'],
> {
  readonly name: string;
  readonly machine: M;
  /** Every state, in display order. Must equal the machine's top-level states. */
  readonly states: ReadonlyArray<S>;
  /** Every event type the machine accepts somewhere. */
  readonly events: ReadonlyArray<E>;
  /** States a new row may be created in. */
  readonly initialStates: ReadonlyArray<S>;
  /** Final states: nothing leaves them. */
  readonly terminalStates: ReadonlyArray<S>;
  readonly Status: Schema.Literals<ReadonlyArray<S>>;
  /** Returns the next state, or `null` when the event is not allowed in `from`. */
  readonly next: (from: S, context: ContextFrom<M>, event: EventFromLogic<M>) => S | null;
  /** The subset of `candidates` the machine accepts in `from` (guards evaluated). */
  readonly allowed: (
    from: S,
    context: ContextFrom<M>,
    candidates: ReadonlyArray<EventFromLogic<M>>,
  ) => ReadonlyArray<E>;
  readonly isTerminal: (state: S) => boolean;
}

export const defineLifecycle = <
  M extends AnyStateMachine,
  const S extends string,
  const E extends EventFromLogic<M>['type'],
>(options: {
  readonly name: string;
  readonly machine: M;
  readonly states: ReadonlyArray<S>;
  readonly events: ReadonlyArray<E>;
  readonly initialStates: ReadonlyArray<S>;
  readonly terminalStates: ReadonlyArray<S>;
}): Lifecycle<M, S, E> => {
  const { machine } = options;
  const resolve = (from: S, context: ContextFrom<M>) =>
    machine.resolveState({ value: from, context });

  const next = (from: S, context: ContextFrom<M>, event: EventFromLogic<M>): S | null => {
    const snapshot = resolve(from, context);
    if (!snapshot.can(event)) return null;
    const [nextSnapshot] = transition(machine, snapshot as SnapshotFrom<M>, event);
    return (nextSnapshot as { readonly value: unknown }).value as S;
  };

  const allowed = (
    from: S,
    context: ContextFrom<M>,
    candidates: ReadonlyArray<EventFromLogic<M>>,
  ): ReadonlyArray<E> => {
    const snapshot = resolve(from, context);
    return candidates.filter((event) => snapshot.can(event)).map((event) => event.type as E);
  };

  const terminal = new Set<string>(options.terminalStates);

  return {
    ...options,
    Status: Schema.Literals(options.states),
    next,
    allowed,
    isTerminal: (state) => terminal.has(state),
  };
};
