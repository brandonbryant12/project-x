import { DecisionsMockLayer, type Decisions } from '@repo/ai';
import { Authenticated, CurrentActor, Unauthorized, type Actor } from '@repo/api';
import { Db, schema } from '@repo/db';
import { layerTestDb } from '@repo/db/testing';
import { eq } from 'drizzle-orm';
import { Context, Effect, Layer, Option, Redacted, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpRouter, HttpServer } from 'effect/http';
import type { SqlClient } from 'effect/sql';
import { Sessions, loadActor } from '../auth/sessions.ts';
import { ALL_MOCK_RULES } from '../features/shared/advisory/question-sets.ts';
import { ApiHandlers } from '../http/api-layer.ts';
import { Background } from '../platform/background.ts';
import type { AppConfig } from '../platform/config.ts';
import { Tracing } from '../platform/langsmith.ts';
import { Settings } from '../platform/settings.ts';

/**
 * Scenario-test harness (docs/testing/strategy.md): real handlers, use cases
 * and SQL on in-process Postgres (PGlite), or a throwaway real Postgres
 * database under `pnpm test:pg`, with the deterministic mock AI and inline
 * background work. Authentication is replaced by `signInAs(name)`;
 * session/cookie handling has its own tests.
 */
export class TestSession extends Context.Service<TestSession, Ref.Ref<Option.Option<Actor>>>()(
  '@repo/server/TestSession',
) {
  static readonly layer = Layer.effect(TestSession, Ref.make(Option.none<Actor>()));
}

const TestAuthenticated = Layer.effect(
  Authenticated,
  Effect.gen(function* () {
    const session = yield* TestSession;
    return Authenticated.of({
      session: (httpEffect) =>
        Effect.gen(function* () {
          const actor = yield* Ref.get(session);
          if (Option.isNone(actor))
            return yield* Effect.fail(new Unauthorized({ message: 'Please sign in.' }));
          return yield* Effect.provideService(httpEffect, CurrentActor, actor.value);
        }),
    });
  }),
);

export const testConfig: AppConfig = {
  nodeEnv: 'test',
  port: 0,
  appOrigin: 'http://localhost:5400',
  databaseUrl: Redacted.make('pglite:memory'),
  migrateOnStart: true,
  migrationsDir: undefined,
  authMode: 'dev',
  entra: {
    tenantId: undefined,
    clientId: undefined,
    clientSecret: undefined,
    flowSecret: undefined,
  },
  decisions: { mode: 'mock', apiKey: undefined, paidTierConfirmed: false },
  langsmith: { tracing: false, apiKey: undefined, project: 'test', content: 'none' },
  telemetry: {
    enabled: false,
    otlpEndpoint: undefined,
    serviceName: 'test',
    serviceVersion: 'test',
    environment: 'test',
  },
  logFormat: 'pretty',
  webDistDir: undefined,
  schedulerEnabled: false,
  notify: {
    transport: 'log',
    smtpHost: undefined,
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: undefined,
    smtpPassword: undefined,
    from: undefined,
  },
};

const services = Layer.mergeAll(
  layerTestDb,
  DecisionsMockLayer(ALL_MOCK_RULES),
  Background.layerInline,
  Tracing.disabled,
  Layer.succeed(Settings, testConfig),
  TestSession.layer,
);

/** Hands the already-built services to each request, so tests and handlers share one database. */
const RequestServices = Layer.effectContext(
  Effect.context<Db | SqlClient.SqlClient | Decisions | Background | Tracing | Settings>(),
);

export const ScenarioLayer = ApiHandlers.pipe(
  HttpRouter.provideRequest(RequestServices),
  Layer.provideMerge(TestAuthenticated),
  Layer.provideMerge(Sessions.layer),
  Layer.provideMerge(services),
  Layer.provideMerge(HttpServer.layerServices),
);

/** Act as a seeded person (by display name) for subsequent API calls. */
export const signInAs = (displayName: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [person] = yield* db
      .select()
      .from(schema.person)
      .where(eq(schema.person.displayName, displayName));
    if (!person) return yield* Effect.die(`no seeded person named ${displayName}`);
    const actor = yield* loadActor(db, person.tenantId, person.id);
    const session = yield* TestSession;
    yield* Ref.set(session, actor);
    return person.id;
  });

/**
 * Scenario tests run on the TestClock (deterministic). Pin "now" to a fixed
 * instant so relative dates in the seeded world are stable across runs.
 */
export const SCENARIO_NOW = Date.parse('2026-11-16T15:00:00Z');
export const atScenarioTime = TestClock.setTime(SCENARIO_NOW);
