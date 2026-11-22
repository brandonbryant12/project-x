import { Effect, Fiber } from 'effect';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createActor, type AnyStateMachine, type EventFromLogic, type SnapshotFrom } from 'xstate';

/**
 * Foldkit-inspired Elm Architecture (TEA) runtime powered by Effect:
 * - Single immutable `Model`
 * - Explicit tagged `Message` union
 * - Pure `update(model, msg) => readonly [nextModel, ReadonlyArray<Command<Message>>]`
 * - Side effects declared as `Effect.Effect<Message | null>` Commands executed in supervised fibers
 *   and interrupted cleanly on disposal.
 */
export type Command<Msg> = Effect.Effect<Msg | null, never, never>;

export type UpdateResult<Model, Msg> = readonly [Model, ReadonlyArray<Command<Msg>>];

export const pure = <Model>(model: Model): UpdateResult<Model, never> => [model, []];

export const withCommands = <Model, Msg>(
  model: Model,
  ...commands: ReadonlyArray<Command<Msg>>
): UpdateResult<Model, Msg> => [model, commands];

export interface TeaRuntime<Model, Msg> {
  readonly getSnapshot: () => Model;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (msg: Msg) => void;
  readonly start: () => void;
  readonly stop: () => void;
}

/** Pure, framework-agnostic Foldkit/TEA runtime backed by Effect fibers. */
export const createTeaRuntime = <Model, Msg>(
  init: () => UpdateResult<Model, Msg>,
  update: (model: Model, msg: Msg) => UpdateResult<Model, Msg>,
): TeaRuntime<Model, Msg> => {
  const [initialModel, initialCommands] = init();
  let model = initialModel;
  let initialized = false;
  const listeners = new Set<() => void>();
  const fibers = new Set<Fiber.Fiber<void, never>>();

  const notify = () => {
    for (const l of listeners) l();
  };

  const runCommands = (commands: ReadonlyArray<Command<Msg>>) => {
    for (const cmd of commands) {
      const fiber = Effect.runFork(
        cmd.pipe(
          Effect.tap((nextMsg) => Effect.sync(() => nextMsg !== null && dispatch(nextMsg))),
          Effect.asVoid,
        ),
      );
      fibers.add(fiber);
      fiber.addObserver(() => {
        fibers.delete(fiber);
      });
    }
  };

  const dispatch = (msg: Msg) => {
    const [nextModel, commands] = update(model, msg);
    model = nextModel;
    notify();
    if (commands.length > 0) runCommands(commands);
  };

  return {
    getSnapshot: () => model,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    start: () => {
      if (initialized) return;
      initialized = true;
      if (initialCommands.length > 0) runCommands(initialCommands);
    },
    stop: () => {
      for (const fiber of fibers) {
        void Effect.runPromise(Fiber.interrupt(fiber));
      }
      fibers.clear();
      initialized = false;
    },
  };
};

/** React 19 Compiler-safe bridge for a Foldkit/Effect TEA program. */
export const useFoldkit = <Model, Msg>(
  init: () => UpdateResult<Model, Msg>,
  update: (model: Model, msg: Msg) => UpdateResult<Model, Msg>,
): readonly [Model, (msg: Msg) => void] => {
  const [runtime] = useState(() => createTeaRuntime(init, update));
  const model = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);

  useEffect(() => {
    runtime.start();
    return () => runtime.stop();
  }, [runtime]);

  return [model, runtime.dispatch] as const;
};

export interface MachineBridge<TMachine extends AnyStateMachine> {
  readonly getSnapshot: () => SnapshotFrom<TMachine>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly send: (event: EventFromLogic<TMachine>) => void;
  readonly start: () => void;
  readonly stop: () => void;
}

/**
 * React 19 StrictMode-safe XState 5 bridge.
 * In XState 5 a stopped actor cannot be restarted; `start()` transparently
 * creates a fresh actor after `stop()` so StrictMode mount/unmount/remount works.
 */
export const createMachineBridge = <TMachine extends AnyStateMachine>(
  machine: TMachine,
): MachineBridge<TMachine> => {
  let actor = createActor(machine);
  let snapshot: SnapshotFrom<TMachine> = actor.getSnapshot();
  let stopped = false;
  let innerSub: { unsubscribe: () => void } | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const l of listeners) l();
  };

  const attach = () => {
    innerSub?.unsubscribe();
    innerSub = actor.subscribe((next) => {
      snapshot = next;
      notify();
    });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send: (event) => {
      actor.send(event);
    },
    start: () => {
      if (stopped) {
        actor = createActor(machine);
        snapshot = actor.getSnapshot();
        stopped = false;
      }
      attach();
      actor.start();
      snapshot = actor.getSnapshot();
      notify();
    },
    stop: () => {
      innerSub?.unsubscribe();
      innerSub = null;
      actor.stop();
      stopped = true;
    },
  };
};

/** React 19 Compiler & StrictMode-safe hook for XState 5 machines via `useSyncExternalStore`. */
export const useMachine = <TMachine extends AnyStateMachine>(
  machine: TMachine,
): readonly [SnapshotFrom<TMachine>, (event: EventFromLogic<TMachine>) => void] => {
  const [bridge] = useState(() => createMachineBridge(machine));
  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot);

  useEffect(() => {
    bridge.start();
    return () => bridge.stop();
  }, [bridge]);

  return [snapshot, bridge.send] as const;
};
