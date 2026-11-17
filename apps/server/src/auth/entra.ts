import { SESSION_COOKIE } from '@repo/api';
import {
  ENTRA_APP_ROLE_TO_GRANT,
  PersonId,
  RoleGrantId,
  type GrantRole,
  type TenantId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Effect, Layer, Option, Redacted } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';
import { recordAudit } from '../features/shared/audit.ts';
import { Settings } from '../platform/settings.ts';
import { today } from '../platform/time.ts';
import { SESSION_ABSOLUTE_DAYS, Sessions } from './sessions.ts';

/**
 * Microsoft Entra ID sign-in (ADR 0006, 0014): authorization code + PKCE via
 * the OpenID-certified `openid-client`. Capabilities come from the ID token's
 * `roles` claim (app roles assigned to AD groups), mirrored to `role_grant`.
 * See docs/architecture/identity-and-access.md.
 */
const FLOW_COOKIE = 'auth_flow';
const FLOW_TTL_SECONDS = 600;

interface Flow {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
  readonly expiresAt: number;
  /** Where to land after sign-in: a notification's deep link (ADR 0018). */
  readonly returnTo?: string;
}

/**
 * Only same-origin paths survive, so sign-in can never become an open
 * redirect: "/observations/obs_…" is kept; "//evil.example", "https://…",
 * "/\\evil" and anything odd fall back to "/".
 */
export const safeReturnPath = (raw: string | undefined): string => {
  if (!raw || raw.length > 512) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  if ([...raw].some((c) => c.charCodeAt(0) < 0x20)) return '/';
  try {
    const url = new URL(raw, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid') return '/';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
};

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

const encodeFlow = (secret: string, flow: Flow) => {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
};

const decodeFlow = (secret: string, value: string | undefined): Flow | undefined => {
  if (!value) return undefined;
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return undefined;
  const expected = Buffer.from(sign(secret, payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
  const flow = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Flow;
  return flow.expiresAt > Date.now() ? flow : undefined;
};

/** Pure: the grants an ID token confers. App roles first; group-id mapping as fallback. */
export const grantsFromClaims = (
  claims: Readonly<Record<string, unknown>>,
  groupGrants: Readonly<Record<string, GrantRole>> = {},
): { readonly grants: ReadonlyArray<GrantRole>; readonly overage: boolean } => {
  const roles = Array.isArray(claims['roles']) ? (claims['roles'] as Array<unknown>) : [];
  const groups = Array.isArray(claims['groups']) ? (claims['groups'] as Array<unknown>) : [];
  const fromRoles = roles.flatMap((r) =>
    typeof r === 'string' && ENTRA_APP_ROLE_TO_GRANT[r] ? [ENTRA_APP_ROLE_TO_GRANT[r]] : [],
  );
  const fromGroups = groups.flatMap((g) =>
    typeof g === 'string' && groupGrants[g] ? [groupGrants[g]] : [],
  );
  const names = claims['_claim_names'];
  const overage = typeof names === 'object' && names !== null && 'groups' in names;
  return { grants: [...new Set([...fromRoles, ...fromGroups])], overage };
};

const page = (message: string, status: number) =>
  HttpServerResponse.text(message, { status, contentType: 'text/plain; charset=utf-8' });

export const EntraRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const settings = yield* Settings;
    if (settings.authMode !== 'entra') return Layer.empty;
    const { tenantId, clientId, clientSecret, flowSecret } = settings.entra;
    if (!tenantId || !clientId || !clientSecret || !flowSecret)
      return yield* Effect.die('entra config missing');
    const secret = Redacted.value(flowSecret);
    const redirectUri = `${settings.appOrigin}/api/auth/entra/callback`;
    const config = yield* Effect.promise(() =>
      oidc.discovery(
        new URL(`https://login.microsoftonline.com/${tenantId}/v2.0`),
        clientId,
        Redacted.value(clientSecret),
      ),
    );
    const secure = settings.nodeEnv === 'production';

    const start = HttpRouter.add(
      'GET',
      '/api/auth/entra/start',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const returnTo = safeReturnPath(
          new URL(request.url, settings.appOrigin).searchParams.get('returnTo') ?? undefined,
        );
        const verifier = oidc.randomPKCECodeVerifier();
        const flow: Flow = {
          returnTo,
          state: oidc.randomState(),
          nonce: oidc.randomNonce(),
          verifier,
          expiresAt: Date.now() + FLOW_TTL_SECONDS * 1000,
        };
        const challenge = yield* Effect.promise(() => oidc.calculatePKCECodeChallenge(verifier));
        const url = oidc.buildAuthorizationUrl(config, {
          redirect_uri: redirectUri,
          scope: 'openid profile email',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: flow.state,
          nonce: flow.nonce,
        });
        return yield* HttpServerResponse.redirect(url.toString()).pipe(
          HttpServerResponse.setCookie(FLOW_COOKIE, encodeFlow(secret, flow), {
            httpOnly: true,
            secure,
            sameSite: 'lax',
            path: '/api/auth/entra',
            maxAge: `${FLOW_TTL_SECONDS} seconds`,
          }),
          Effect.orDie,
        );
      }),
    );

    const callback = HttpRouter.add(
      'GET',
      '/api/auth/entra/callback',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const flow = decodeFlow(secret, request.cookies[FLOW_COOKIE]);
        if (!flow) return page('Your sign-in expired. Please start again.', 400);
        const currentUrl = new URL(request.url, settings.appOrigin);
        const tokens = yield* Effect.tryPromise(() =>
          oidc.authorizationCodeGrant(config, currentUrl, {
            pkceCodeVerifier: flow.verifier,
            expectedState: flow.state,
            expectedNonce: flow.nonce,
            idTokenExpected: true,
          }),
        ).pipe(Effect.option);
        const claims = Option.isSome(tokens) ? tokens.value.claims() : undefined;
        if (!claims) return page('Microsoft did not confirm your sign-in. Please try again.', 401);
        // Defence in depth: the issuer check already binds the tenant; refuse any other tid too.
        if (claims['tid'] !== tenantId) {
          return page('This account belongs to a different organization.', 403);
        }
        const result = yield* provisionFromClaims(
          claims as unknown as Readonly<Record<string, unknown>>,
        );
        if (result._tag === 'Refused') return page(result.message, 403);
        const sessions = yield* Sessions;
        const token = yield* sessions
          .create(result.tenantId, result.personId, 'entra')
          .pipe(Effect.orDie);
        const withSession = yield* HttpServerResponse.setCookie(
          HttpServerResponse.redirect(`${settings.appOrigin}${safeReturnPath(flow.returnTo)}`),
          SESSION_COOKIE,
          Redacted.value(token),
          {
            httpOnly: true,
            secure,
            sameSite: 'lax',
            path: '/',
            maxAge: `${SESSION_ABSOLUTE_DAYS} days`,
          },
        ).pipe(Effect.orDie);
        return yield* HttpServerResponse.expireCookie(withSession, FLOW_COOKIE, {
          path: '/api/auth/entra',
        }).pipe(Effect.orDie);
      }).pipe(Effect.orDie),
    );
    return Layer.mergeAll(start, callback);
  }),
);

type Provisioned =
  | { readonly _tag: 'Provisioned'; readonly tenantId: TenantId; readonly personId: PersonId }
  | { readonly _tag: 'Refused'; readonly message: string };

/**
 * Upserts the person by Entra object id (falling back to email for people
 * imported before their first sign-in) and mirrors app-role grants.
 */
const provisionFromClaims = Effect.fn('auth.provision')(function* (
  claims: Readonly<Record<string, unknown>>,
) {
  const db = yield* Db;
  const tid = typeof claims['tid'] === 'string' ? claims['tid'] : undefined;
  const oid = typeof claims['oid'] === 'string' ? claims['oid'] : undefined;
  const email =
    (typeof claims['email'] === 'string' && claims['email']) ||
    (typeof claims['preferred_username'] === 'string' && claims['preferred_username']) ||
    `${oid}@entra.invalid`;
  const name = typeof claims['name'] === 'string' ? claims['name'] : email;
  if (!tid || !oid)
    return {
      _tag: 'Refused',
      message: 'Your Microsoft account is missing required details.',
    } satisfies Provisioned as Provisioned;
  const [tenant] = yield* db
    .select()
    .from(schema.tenant)
    .where(eq(schema.tenant.entraTenantId, tid));
  if (!tenant)
    return {
      _tag: 'Refused',
      message: 'Your organization is not set up yet.',
    } satisfies Provisioned as Provisioned;
  const { grants, overage } = grantsFromClaims(claims, tenant.settings.groupGrants);
  if (
    overage &&
    tenant.settings.groupGrants &&
    Object.keys(tenant.settings.groupGrants).length > 0
  ) {
    // Fail closed: we cannot see all groups (ADR 0006).
    return {
      _tag: 'Refused',
      message:
        'You belong to too many groups for sign-in to read. Ask your administrator to use app roles.',
    } satisfies Provisioned as Provisioned;
  }
  const on = yield* today;
  return yield* transactionally(
    Effect.gen(function* () {
      const [byOid] = yield* db
        .select()
        .from(schema.person)
        .where(and(eq(schema.person.tenantId, tenant.id), eq(schema.person.entraObjectId, oid)));
      const [byEmail] = byOid
        ? [byOid]
        : yield* db
            .select()
            .from(schema.person)
            .where(
              and(
                eq(schema.person.tenantId, tenant.id),
                sql`lower(${schema.person.email}) = lower(${email})`,
                isNull(schema.person.entraObjectId),
              ),
            );
      const personId = byEmail?.id ?? PersonId.generate();
      if (byEmail) {
        yield* db
          .update(schema.person)
          .set({ entraObjectId: oid, displayName: name })
          .where(eq(schema.person.id, personId));
      } else {
        yield* db.insert(schema.person).values({
          id: personId,
          tenantId: tenant.id,
          entraObjectId: oid,
          email,
          displayName: name,
        });
      }
      if (byEmail?.status === 'departed')
        return {
          _tag: 'Refused',
          message: 'Your access has ended.',
        } satisfies Provisioned as Provisioned;
      const open = yield* db
        .select()
        .from(schema.roleGrant)
        .where(
          and(
            eq(schema.roleGrant.personId, personId),
            isNull(schema.roleGrant.validTo),
            eq(schema.roleGrant.source, 'entra'),
          ),
        );
      for (const grant of open.filter((g) => !grants.includes(g.role))) {
        yield* grant.validFrom === on
          ? db.delete(schema.roleGrant).where(eq(schema.roleGrant.id, grant.id))
          : db
              .update(schema.roleGrant)
              .set({ validTo: on })
              .where(eq(schema.roleGrant.id, grant.id));
      }
      const added = grants.filter((role) => !open.some((g) => g.role === role));
      if (added.length > 0) {
        yield* db.insert(schema.roleGrant).values(
          added.map((role) => ({
            id: RoleGrantId.generate(),
            tenantId: tenant.id,
            personId,
            role,
            validFrom: on,
            source: 'entra',
          })),
        );
      }
      yield* recordAudit(
        { tenantId: tenant.id, personId },
        {
          entityType: 'session',
          entityId: personId,
          event: 'SIGN_IN',
          data: { method: 'entra', grants },
        },
      );
      return {
        _tag: 'Provisioned',
        tenantId: tenant.id,
        personId,
      } satisfies Provisioned as Provisioned;
    }),
  );
});
