import { DecisionsMockLayer } from '@repo/ai';
import { Db, schema } from '@repo/db';
import { layerTestDb } from '@repo/db/testing';
import { assert, layer } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { Context, Effect, Layer, Redacted, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import {
  HttpEffect,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http';
import { afterAll } from 'vitest';
import { ALL_MOCK_RULES } from '../features/shared/advisory/question-sets.ts';
import { apiRoutes } from '../http/api-layer.ts';
import { SecurityMiddleware } from '../http/security.ts';
import { Background } from '../platform/background.ts';
import type { AppConfig } from '../platform/config.ts';
import { Settings } from '../platform/settings.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { makeFakeEntra } from '../test/fake-oidc.ts';
import { SCENARIO_NOW, testConfig } from '../test/harness.ts';
import { AuthenticatedLive } from './authenticated.ts';
import { EntraRoutes } from './entra.ts';
import { SESSION_ABSOLUTE_DAYS, SESSION_IDLE_MS, Sessions } from './sessions.ts';

/**
 * Journey: sign-in, session expiry and sign-out, through the real HTTP stack
 * (routes, CSRF middleware, session middleware) against a fake Entra issuer.
 * Protects ADR 0014 and controls CC6.1/CC6.6: only a token our issuer signed
 * for this request (state, nonce, PKCE, issuer) creates a session; capabilities
 * come from app roles and are withdrawn when the role goes; sessions die when
 * idle, at their absolute lifetime and at sign-out; cross-site writes are
 * refused.
 */
const ENTRA_TENANT = '7f0c1d1e-0000-4000-8000-000000000001';
const CLIENT_ID = 'coaching-client';
const ORIGIN = 'http://localhost:5400';

const entra = makeFakeEntra({ tenantId: ENTRA_TENANT, clientId: CLIENT_ID });
entra.install();
afterAll(entra.uninstall);

const config: AppConfig = {
  ...testConfig,
  appOrigin: ORIGIN,
  authMode: 'entra',
  entra: {
    tenantId: ENTRA_TENANT,
    clientId: CLIENT_ID,
    clientSecret: Redacted.make('client-secret'),
    flowSecret: Redacted.make('flow-secret'),
  },
};

/** The served app as one request handler, the way the Node server runs it. */
class App extends Context.Service<
  App,
  Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    unknown,
    Scope.Scope | HttpServerRequest.HttpServerRequest
  >
>()('test/App') {}

const routes = Layer.mergeAll(apiRoutes(AuthenticatedLive), EntraRoutes, SecurityMiddleware);

// The handler also needs the request services (Db, Settings, …); each test
// fiber already holds them, with its TestClock, so they are left to it.
const AuthLayer = Layer.effect(
  App,
  Effect.map(HttpRouter.toHttpEffect(routes), (handler) => handler as App['Service']),
).pipe(
  Layer.provideMerge(Sessions.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      layerTestDb,
      DecisionsMockLayer(ALL_MOCK_RULES),
      Background.layerInline,
      Layer.succeed(Settings, config),
    ),
  ),
  Layer.provideMerge(HttpServer.layerServices),
);

interface Sent {
  readonly method?: string;
  readonly cookies?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Sends one request through the whole HTTP stack, as a browser on the app's origin would. */
const send = (path: string, sent: Sent = {}) =>
  Effect.gen(function* () {
    const app = yield* App;
    const cookie = Object.entries(sent.cookies ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const request = new Request(`http://localhost:4400${path}`, {
      method: sent.method ?? 'GET',
      headers: { ...(cookie && { cookie }), ...sent.headers },
    });
    // toHandled is what the Node server runs per request: it turns failures into
    // responses and applies pre-response handlers (where cookies are set).
    let response: HttpServerResponse.HttpServerResponse | undefined;
    yield* HttpEffect.toHandled(app, (_request, outgoing) =>
      Effect.sync(() => {
        response = outgoing;
      }),
    ).pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(request),
      ),
    );
    if (!response) return yield* Effect.die('no response was sent');
    return HttpServerResponse.toWeb(response);
  });

const setCookies = (response: Response) =>
  Object.fromEntries(
    response.headers.getSetCookie().map((line) => {
      const [pair = ''] = line.split(';');
      const at = pair.indexOf('=');
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );

/** Start at /api/auth/entra/start, "sign in" at the issuer, return to the callback. */
const signIn = (
  claims: Readonly<Record<string, unknown>>,
  tamper: { readonly state?: string; readonly flowCookie?: string } = {},
) =>
  Effect.gen(function* () {
    const start = yield* send('/api/auth/entra/start');
    assert.strictEqual(start.status, 302);
    const flow = setCookies(start)['auth_flow'];
    assert.isDefined(flow);
    const { code, state } = entra.authorize(start.headers.get('location') ?? '', claims);
    const query = new URLSearchParams({ code, state: tamper.state ?? state });
    const callback = yield* send(`/api/auth/entra/callback?${query}`, {
      cookies: { auth_flow: tamper.flowCookie ?? flow },
    });
    return { status: callback.status, session: setCookies(callback)['session'] };
  });

const me = (session: string | undefined) =>
  Effect.gen(function* () {
    const response = yield* send('/api/session', { cookies: session ? { session } : {} });
    if (response.status !== 200) return { status: response.status, grants: [] as Array<string> };
    const body = (yield* Effect.promise(() => response.json())) as { grants: Array<string> };
    return { status: response.status, grants: body.grants };
  });

const writeHeaders = { 'x-requested-with': 'fetch', origin: ORIGIN };

const maya = {
  oid: 'oid-maya',
  email: 'maya.chen@northwind.example',
  name: 'Maya Chen',
};

layer(AuthLayer, { timeout: 60_000 })('sign-in, sessions and sign-out', (it) => {
  it.effect('the seeded tenant is bound to the Entra tenant', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SCENARIO_NOW);
      yield* seedWorld;
      const db = yield* Db;
      yield* db.update(schema.tenant).set({ entraTenantId: ENTRA_TENANT });
    }),
  );

  it.effect('app roles become grants, and a withdrawn role is withdrawn at the next sign-in', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SCENARIO_NOW);
      const first = yield* signIn({ ...maya, roles: ['Coach', 'ComplianceReviewer', 'Unknown'] });
      assert.strictEqual(first.status, 302);
      const before = yield* me(first.session);
      assert.strictEqual(before.status, 200);
      assert.sameMembers(before.grants, ['coach', 'compliance_reviewer']);

      const second = yield* signIn({ ...maya, roles: ['Coach'] });
      const after = yield* me(second.session);
      assert.sameMembers(after.grants, ['coach']);
      // The earlier session sees the same, current grants: capabilities are loaded per request.
      assert.sameMembers((yield* me(first.session)).grants, ['coach']);
    }),
  );

  it.effect('a callback whose state, nonce, flow cookie or issuer does not match is refused', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SCENARIO_NOW);
      const db = yield* Db;
      const sessionsBefore = (yield* db.select().from(schema.session)).length;

      const wrongState = yield* signIn(maya, { state: 'forged-state' });
      assert.strictEqual(wrongState.status, 401);

      entra.tamperNextToken({ nonce: 'replayed-nonce' });
      const wrongNonce = yield* signIn(maya);
      assert.strictEqual(wrongNonce.status, 401);

      const forgedFlow = yield* signIn(maya, { flowCookie: 'eyJzdGF0ZSI6IngifQ.forged' });
      assert.strictEqual(forgedFlow.status, 400);

      // A token from another Entra tenant (its own issuer and tid) never verifies here.
      const other = '7f0c1d1e-0000-4000-8000-000000000002';
      entra.tamperNextToken({ iss: `https://login.microsoftonline.com/${other}/v2.0`, tid: other });
      const otherIssuer = yield* signIn(maya);
      assert.strictEqual(otherIssuer.status, 401);

      // Our issuer, but a tenant id no tenant is bound to.
      entra.tamperNextToken({ tid: other });
      const unknownTenant = yield* signIn(maya);
      assert.strictEqual(unknownTenant.status, 403);

      for (const refused of [wrongState, wrongNonce, forgedFlow, otherIssuer, unknownTenant])
        assert.isUndefined(refused.session);
      assert.strictEqual((yield* db.select().from(schema.session)).length, sessionsBefore);
    }),
  );

  it.effect('a person who has left is refused at sign-in', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SCENARIO_NOW);
      const db = yield* Db;
      yield* db
        .update(schema.person)
        .set({ status: 'departed' })
        .where(eq(schema.person.email, 'grace.liu@northwind.example'));
      const refused = yield* signIn({
        oid: 'oid-grace',
        email: 'grace.liu@northwind.example',
        name: 'Grace Liu',
      });
      assert.strictEqual(refused.status, 403);
      assert.isUndefined(refused.session);
    }),
  );

  it.effect('a session ends after 12 idle hours, however often it was used before', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SCENARIO_NOW);
      const { session } = yield* signIn(maya);
      yield* TestClock.adjust(SESSION_IDLE_MS - 60_000);
      assert.strictEqual((yield* me(session)).status, 200);
      yield* TestClock.adjust(SESSION_IDLE_MS - 60_000);
      assert.strictEqual((yield* me(session)).status, 200);
      yield* TestClock.adjust(SESSION_IDLE_MS + 60_000);
      assert.strictEqual((yield* me(session)).status, 401);
    }),
  );

  it.effect('a session ends at its absolute lifetime even when used throughout', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SCENARIO_NOW);
      const { session } = yield* signIn(maya);
      const step = 11 * 60 * 60 * 1000;
      const lifetime = SESSION_ABSOLUTE_DAYS * 86_400_000;
      for (let elapsed = step; elapsed < lifetime; elapsed += step) {
        yield* TestClock.adjust(step);
        assert.strictEqual((yield* me(session)).status, 200);
      }
      yield* TestClock.adjust(step);
      assert.strictEqual((yield* me(session)).status, 401);
    }),
  );

  it.effect('sign-out revokes the session on the server, not just the cookie', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SCENARIO_NOW);
      const db = yield* Db;
      const { session } = yield* signIn(maya);
      assert.isDefined(session);
      const out = yield* send('/api/auth/sign-out', {
        method: 'POST',
        cookies: { session: session ?? '' },
        headers: writeHeaders,
      });
      assert.strictEqual(out.status, 204);
      assert.strictEqual(setCookies(out)['session'], '');
      // Replaying the old cookie no longer works, and no session row matches it.
      assert.strictEqual((yield* me(session)).status, 401);
      const sessions = yield* Sessions;
      assert.isTrue((yield* sessions.resolve(session ?? '')).pipe((o) => o._tag === 'None'));
      const audit = yield* db
        .select()
        .from(schema.auditEvent)
        .where(
          and(eq(schema.auditEvent.entityType, 'session'), eq(schema.auditEvent.event, 'SIGN_IN')),
        );
      assert.isAbove(audit.length, 0);
    }),
  );

  it.effect('state-changing requests need the app header and, when sent, the app origin', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SCENARIO_NOW);
      const { session } = yield* signIn(maya);
      const post = (headers: Record<string, string>) =>
        send('/api/auth/sign-out', {
          method: 'POST',
          cookies: { session: session ?? '' },
          headers,
        });
      assert.strictEqual((yield* post({ origin: ORIGIN })).status, 403);
      assert.strictEqual(
        (yield* post({ 'x-requested-with': 'fetch', origin: 'https://evil.example' })).status,
        403,
      );
      // Both refusals left the session alive.
      assert.strictEqual((yield* me(session)).status, 200);
      assert.strictEqual((yield* post({ 'x-requested-with': 'fetch' })).status, 204);
    }),
  );
});
