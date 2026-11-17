import { PgClient } from '@effect/sql-pg';
import * as PgliteClient from '@effect/sql-pglite/PgliteClient';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import * as PgliteDrizzle from 'drizzle-orm/effect-pglite';
import { migrate as migratePglite } from 'drizzle-orm/effect-pglite/migrator';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { migrate } from 'drizzle-orm/effect-postgres/migrator';
import { Context, Effect, Layer, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';
import type { SqlError } from 'effect/sql/SqlError';
import { fileURLToPath } from 'node:url';

export * as schema from './schema/index.ts';
export type {
  AdvisoryAnswersRecord,
  BadgeCriteriaSnapshot,
  TenantSettings,
} from './schema/index.ts';

/**
 * The query surface every repository uses. Production runs it over
 * `@effect/sql-pg`; tests run the identical surface over PGlite (ADR 0004).
 */
export type Database = PgDrizzle.EffectPgDatabase;

export class Db extends Context.Service<Db, Database>()('@repo/db/Db') {}

/** Default location of the generated migrations (packages/db/drizzle). */
export const defaultMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface PgOptions {
  readonly url: Redacted.Redacted;
  /** Apply pending migrations at startup (dev, single-replica deployments). */
  readonly migrate: boolean;
  readonly migrationsFolder?: string;
  readonly maxConnections?: number;
}

/** `Db` plus `SqlClient` (for transactions) over a real PostgreSQL pool. */
export const layerPg = (options: PgOptions): Layer.Layer<Db | SqlClient.SqlClient, unknown> =>
  Layer.effect(
    Db,
    Effect.gen(function* () {
      const db = yield* PgDrizzle.makeWithDefaults();
      if (options.migrate) {
        yield* migrate(db, {
          migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
        });
        yield* Effect.logInfo('database migrations applied');
      }
      return db;
    }),
  ).pipe(
    Layer.provideMerge(
      PgClient.layer({ url: options.url, maxConnections: options.maxConnections ?? 10 }),
    ),
  );

/**
 * File-backed PGlite for zero-infrastructure local development (`pnpm dev`
 * without Docker). Same schema and migrations as PostgreSQL.
 */
export const layerPgliteDir = (options: {
  readonly dataDir: string;
  readonly migrate: boolean;
  readonly migrationsFolder?: string;
}): Layer.Layer<Db | SqlClient.SqlClient, unknown> =>
  Layer.effect(
    Db,
    Effect.gen(function* () {
      const db = yield* PgliteDrizzle.makeWithDefaults();
      if (options.migrate) {
        yield* migratePglite(db, {
          migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
        });
      }
      // Same query surface as effect-postgres; see testing.ts.
      return db as unknown as Database;
    }),
  ).pipe(
    Layer.provideMerge(
      PgliteClient.layer({ dataDir: options.dataDir, extensions: { btree_gist } }),
    ),
  );

/** Picks PostgreSQL or file-backed PGlite from a `DATABASE_URL`. */
export const layerFromUrl = (options: {
  readonly url: Redacted.Redacted<string>;
  readonly migrate: boolean;
  readonly migrationsFolder?: string;
}): Layer.Layer<Db | SqlClient.SqlClient, unknown> => {
  const raw = Redacted.value(options.url);
  return raw.startsWith('pglite:')
    ? layerPgliteDir({ ...options, dataDir: raw.slice('pglite:'.length) })
    : layerPg({ ...options, url: options.url });
};

/**
 * Runs `effect` in one SQL transaction. Repositories using `Db` inside it join the
 * transaction automatically: Effect SQL keeps the connection in fiber context.
 * Never call an external provider inside a transaction (ADR 0003).
 */
export const transactionally = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SqlError, R | SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(effect);
  });
