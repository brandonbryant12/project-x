import { DecisionsMockLayer } from '@repo/ai';
import { Db, layerFromUrl, layerPg } from '@repo/db';
import { NodeRuntime } from '@effect/platform-node';
import { sql } from 'drizzle-orm';
import { Effect, Layer, Redacted } from 'effect';
import { rmSync } from 'node:fs';
import { ALL_MOCK_RULES } from '../features/shared/advisory/question-sets.ts';
import { Background } from '../platform/background.ts';
import { AppConfig, validateConfig } from '../platform/config.ts';
import { Tracing } from '../platform/langsmith.ts';
import { Settings } from '../platform/settings.ts';
import { seedCohort } from './seed-cohort.ts';
import { seedWorld } from './seed-world.ts';

/**
 *   pnpm db:seed           — seed the fictional firm if empty
 *   pnpm db:reset          — wipe, migrate and seed (refuses in production)
 */
const reset = (url: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const raw = Redacted.value(url);
    if (raw.startsWith('pglite:')) {
      rmSync(raw.slice('pglite:'.length), { recursive: true, force: true });
      return;
    }
    yield* Effect.gen(function* () {
      const db = yield* Db;
      yield* db.execute(sql`drop schema if exists public cascade`);
      yield* db.execute(sql`drop schema if exists drizzle cascade`);
      yield* db.execute(sql`create schema public`);
    }).pipe(Effect.provide(layerPg({ url, migrate: false })));
  });

const main = Effect.gen(function* () {
  const config = yield* validateConfig(yield* AppConfig);
  if (process.argv.includes('--reset')) {
    if (config.nodeEnv === 'production')
      return yield* Effect.die('refusing to reset a production database');
    yield* reset(config.databaseUrl);
    yield* Effect.logInfo('seed: database reset');
  }
  yield* Effect.andThen(seedWorld, seedCohort).pipe(
    Effect.provide(
      Layer.mergeAll(
        layerFromUrl({ url: config.databaseUrl, migrate: true }),
        DecisionsMockLayer(ALL_MOCK_RULES),
        Background.layerInline,
        Tracing.disabled,
        Layer.succeed(Settings, config),
      ),
    ),
  );
});

main.pipe(NodeRuntime.runMain);
