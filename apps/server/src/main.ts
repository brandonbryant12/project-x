import { NodeRuntime } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { AppConfig } from './platform/config.ts';
import { buildServerLayer, resolveRuntimePlan } from './platform/stack.ts';

const main = Effect.gen(function* () {
  const plan = yield* resolveRuntimePlan(yield* AppConfig);
  yield* Effect.logInfo(
    `server starting on :${plan.config.port} (auth=${plan.auth._tag}, decisions=${plan.decisions._tag}, notify=${plan.notifier._tag})`,
  );
  return yield* Layer.launch(buildServerLayer(plan));
});

main.pipe(NodeRuntime.runMain);
