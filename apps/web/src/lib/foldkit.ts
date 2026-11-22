import { Effect, Fiber } from 'effect';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createActor, type AnyStateMachine, type SnapshotFrom } from 'xstate';

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
  let started = false;
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
      if (started) return;
      started = true;
      if (initialCommands.length > 0) runCommands(initialCommands);
    },
    stop: () => {
      for (const fiber of fibers) {
        void Effect.runPromise(Fiber.interrupt(fiber));
      }
      fibers.clear();
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

/** React 19 Compiler-safe hook for XState 5 machines via `useSyncExternalStore`. */
export const useMachine = <TMachine extends AnyStateMachine>(
  machine: TMachine,
): readonly [SnapshotFrom<TMachine>, ReturnType<typeof createActor<TMachine>>['send']] => {
  const [actor] = useState(() => createActor(machine));
  const snapshot = useSyncExternalStore(
    (onStoreChange) => {
      const sub = actor.subscribe(onStoreChange);
      return () => sub.unsubscribe();
    },
    () => actor.getSnapshot(),
    () => actor.getSnapshot(),
  );

  useEffect(() => {
    actor.start();
    return () => {
      actor.stop();
    };
  }, [actor]);

  return [snapshot, actor.send] as const;
};
