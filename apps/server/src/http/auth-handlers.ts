import { Api, CurrentActor, Forbidden, NotFound, sessionSecurity } from '@repo/api';
import type { PersonId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { asc, eq } from 'drizzle-orm';
import { Effect, Redacted } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { SESSION_ABSOLUTE_DAYS, Sessions } from '../auth/sessions.ts';
import { recordAudit } from '../features/shared/audit.ts';
import { relationFlags } from '../features/shared/directory.ts';
import { toPersonSummary } from '../features/shared/people.ts';
import { loadRelationshipFacts } from '../features/shared/relationships.ts';
import { Settings } from '../platform/settings.ts';
import { apiErrorsOnly } from './api-errors.ts';
import { today } from '../platform/time.ts';

const cookieOptions = (secure: boolean) => ({
  secure,
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: `${SESSION_ABSOLUTE_DAYS} days` as const,
});

export const AuthHandlers = HttpApiBuilder.group(
  Api,
  'auth',
  Effect.fn(function* (handlers) {
    const settings = yield* Settings;
    const sessions = yield* Sessions;
    const db = yield* Db;
    const devOnly =
      settings.authMode === 'dev'
        ? Effect.void
        : Effect.fail(
            new Forbidden({ message: 'Persona sign-in is only available in development.' }),
          );
    const secureCookie = settings.nodeEnv === 'production';

    return handlers
      .handle('devPersonas', () =>
        Effect.gen(function* () {
          yield* devOnly;
          const people = yield* db
            .select()
            .from(schema.person)
            .where(eq(schema.person.status, 'active'))
            .orderBy(asc(schema.person.displayName));
          const on = yield* today;
          const result = [];
          for (const person of people) {
            const facts = yield* loadRelationshipFacts(person.tenantId);
            const flags = relationFlags(facts, person.id, on);
            const grants = yield* db
              .select({ role: schema.roleGrant.role })
              .from(schema.roleGrant)
              .where(eq(schema.roleGrant.personId, person.id));
            const parts = [person.title ?? 'Team member'];
            if (flags.hasReports) parts.push('leads a team');
            if (flags.isCoach) parts.push('coach');
            if (grants.some((g) => g.role === 'catalog_keeper')) parts.push('catalog keeper');
            if (grants.some((g) => g.role === 'tenant_admin')) parts.push('admin');
            result.push({ person: toPersonSummary(person), summary: parts.join(' · ') });
          }
          return result;
        }).pipe(apiErrorsOnly),
      )
      .handle('devSignIn', ({ payload }) =>
        Effect.gen(function* () {
          yield* devOnly;
          const [person] = yield* db
            .select()
            .from(schema.person)
            .where(eq(schema.person.id, payload.personId as PersonId));
          if (!person)
            return yield* Effect.fail(new NotFound({ entity: 'person', id: payload.personId }));
          const token = yield* sessions.create(person.tenantId, person.id, 'dev');
          yield* HttpApiBuilder.securitySetCookie(
            sessionSecurity,
            token,
            cookieOptions(secureCookie),
          );
          yield* recordAudit(
            { tenantId: person.tenantId, personId: person.id },
            {
              entityType: 'session',
              entityId: person.id,
              event: 'SIGN_IN',
              data: { method: 'dev' },
            },
          );
        }).pipe(apiErrorsOnly),
      )
      .handle('signOut', () =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const token = request.cookies[sessionSecurity.key];
          if (token) yield* sessions.revoke(token);
          yield* HttpApiBuilder.securitySetCookie(sessionSecurity, Redacted.make(''), {
            ...cookieOptions(secureCookie),
            maxAge: 0,
          });
        }).pipe(Effect.orDie),
      );
  }),
);

export const SessionHandlers = HttpApiBuilder.group(
  Api,
  'session',
  Effect.fn(function* (handlers) {
    const settings = yield* Settings;
    const db = yield* Db;
    return handlers.handle('me', () =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        const [person] = yield* db
          .select()
          .from(schema.person)
          .where(eq(schema.person.id, actor.personId));
        const [tenant] = yield* db
          .select()
          .from(schema.tenant)
          .where(eq(schema.tenant.id, actor.tenantId));
        if (!person || !tenant)
          return yield* Effect.die('invariant: session person or tenant missing');
        const facts = yield* loadRelationshipFacts(actor.tenantId);
        const flags = relationFlags(facts, actor.personId, yield* today);
        return {
          person: toPersonSummary(person),
          email: person.email,
          tenant: { id: tenant.id, name: tenant.name },
          grants: actor.grants,
          relations: flags,
          authMode: settings.authMode,
        };
      }).pipe(Effect.orDie),
    );
  }),
);
