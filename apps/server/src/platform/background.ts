import { Context, Effect, FiberSet, Layer } from 'effect';

/**
 * Runs work outside the request (advisory checks). Use it through
 * `afterCommit`, which waits for the surrounding transaction to commit. In the
 * server it forks into a scoped FiberSet so shutdown interrupts cleanly; tests
 * and the seed script use `layerInline` to make results deterministic.
 */
export class Background extends Context.Service<
  Background,
  { readonly run: (effect: Effect.Effect<void, never, never>) => Effect.Effect<void> }
>()('@repo/server/Background') {
  static readonly layer = Layer.effect(
    Background,
    Effect.gen(function* () {
      const set = yield* FiberSet.make();
      return Background.of({
        run: (effect) =>
          FiberSet.run(
            set,
            effect.pipe(
              Effect.catchCause((cause) => Effect.logError('background task failed', cause)),
            ),
          ).pipe(Effect.asVoid),
      });
    }),
  );

  static readonly layerInline = Layer.succeed(
    Background,
    Background.of({ run: (effect) => effect }),
  );
}
