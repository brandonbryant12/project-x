import { Db } from '@repo/db';
import { sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

/** Liveness and readiness (controls A1.2). Readiness proves the database answers. */
export const HealthRoutes = Layer.mergeAll(
  HttpRouter.add('GET', '/healthz', HttpServerResponse.text('ok')),
  HttpRouter.add(
    'GET',
    '/readyz',
    Effect.gen(function* () {
      const db = yield* Db;
      yield* db.execute(sql`select 1`);
      return HttpServerResponse.text('ready');
    }).pipe(
      Effect.catch(() => Effect.succeed(HttpServerResponse.text('not ready', { status: 503 }))),
    ),
  ),
);
