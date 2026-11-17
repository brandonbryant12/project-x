import { PgClient } from '@effect/sql-pg';
import * as PgliteClient from '@effect/sql-pglite/PgliteClient';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import * as PgliteDrizzle from 'drizzle-orm/effect-pglite';
import { migrate as migratePglite } from 'drizzle-orm/effect-pglite/migrator';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { migrate } from 'drizzle-orm/effect-postgres/migrator';
import { Clock, Effect, Layer, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';
import { randomBytes } from 'node:crypto';
import { Db, defaultMigrationsFolder, type Database } from './index.ts';

/**
 * A fresh, migrated, in-process PostgreSQL (PGlite) per layer build. No Docker.
 * The PGlite driver exposes the same query surface as effect-postgres; only the
 * raw `execute` result shape differs, which repositories do not depend on.
 */
export const layerPglite: Layer.Layer<Db | SqlClient.SqlClient> = Layer.effect(
  Db,
  Effect.gen(function* () {
    const db = yield* PgliteDrizzle.makeWithDefaults();
    yield* migratePglite(db, { migrationsFolder: defaultMigrationsFolder });
    // Safe: identical query HKTs; see the module comment.
    return db as unknown as Database;
  }),
).pipe(Layer.provideMerge(PgliteClient.layer({ extensions: { btree_gist } })), Layer.orDie);

const POOL_SIZE = 4;
const RealClock = Layer.succeed(Clock.Clock, Clock.Clock.defaultValue());

/**
 * The Postgres lane (docs/testing/strategy.md, `pnpm test:pg`): a throwaway
 * database on a real PostgreSQL server per layer build. `adminUrl` points at
 * any database the role can connect to; the scratch database is created next
 * to it, migrated, and dropped (WITH FORCE) when the layer's scope closes. The
 * database named in `adminUrl` is never written.
 */
export const layerPostgresScratch = (adminUrl: string): Layer.Layer<Db | SqlClient.SqlClient> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const name = `test_${randomBytes(6).toString('hex')}`;
      const admin = PgClient.layer({ url: Redacted.make(adminUrl), maxConnections: 1 }).pipe(
        Layer.provide(RealClock),
      );
      const run = (statement: string) =>
        Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement)).pipe(
          Effect.provide(admin),
        );
      yield* Effect.acquireRelease(run(`create database "${name}"`), () =>
        run(`drop database if exists "${name}" with (force)`).pipe(Effect.orDie),
      );
      const url = new URL(adminUrl);
      url.pathname = `/${name}`;
      // Every connection opens now, and the pool keeps time on the real clock.
      // Suites build layers under TestClock and scenarios jump it years ahead,
      // which would expire every idle connection; a reconnect then runs under
      // TestClock or the seed's fixed clock, where the connect timeout never
      // fires (TestClock) or fires at once (a clock whose sleep returns).
      return Layer.effect(
        Db,
        Effect.gen(function* () {
          const db = yield* PgDrizzle.makeWithDefaults();
          yield* migrate(db, { migrationsFolder: defaultMigrationsFolder });
          return db;
        }),
      ).pipe(
        Layer.provideMerge(
          PgClient.layer({
            url: Redacted.make(url.toString()),
            minConnections: POOL_SIZE,
            maxConnections: POOL_SIZE,
            idleTimeout: '1 hour',
          }),
        ),
        Layer.provide(RealClock),
      );
    }),
  ).pipe(Layer.orDie);

/**
 * The database every integrity and scenario suite runs on: PGlite by default
 * (fast, no Docker); real PostgreSQL when `TEST_DATABASE_URL` is set.
 */
export const layerTestDb: Layer.Layer<Db | SqlClient.SqlClient> = process.env['TEST_DATABASE_URL']
  ? layerPostgresScratch(process.env['TEST_DATABASE_URL'])
  : layerPglite;
