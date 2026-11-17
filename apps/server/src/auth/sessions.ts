import type { Actor } from '@repo/api';
import { SessionId, type GrantRole, type PersonId, type TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { Context, Effect, Layer, Option, Redacted } from 'effect';
import { createHash, randomBytes } from 'node:crypto';
import { addDays, now, today } from '../platform/time.ts';

/**
 * First-party sessions (ADR 0014). The cookie holds an opaque random token;
 * only its SHA-256 hash is stored. Idle timeout 12 h, absolute lifetime 7 d.
 */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_DAYS = 7;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class Sessions extends Context.Service<
  Sessions,
  {
    readonly create: (
      tenantId: TenantId,
      personId: PersonId,
      method: 'entra' | 'dev',
    ) => Effect.Effect<Redacted.Redacted<string>, unknown>;
    readonly resolve: (token: string) => Effect.Effect<Option.Option<Actor>, unknown>;
    readonly revoke: (token: string) => Effect.Effect<void, unknown>;
  }
>()('@repo/server/Sessions') {
  static readonly layer = Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const db = yield* Db;

      const create = Effect.fn('sessions.create')(function* (
        tenantId: TenantId,
        personId: PersonId,
        method: 'entra' | 'dev',
      ) {
        const token = randomBytes(32).toString('base64url');
        const at = yield* now;
        yield* db.insert(schema.session).values({
          id: SessionId.generate(),
          tenantId,
          personId,
          tokenHash: hashToken(token),
          method,
          lastSeenAt: at,
          expiresAt: addDays(at, SESSION_ABSOLUTE_DAYS),
        });
        return Redacted.make(token);
      });

      const resolve = Effect.fn('sessions.resolve')(function* (token: string) {
        const at = yield* now;
        const [row] = yield* db
          .select()
          .from(schema.session)
          .where(
            and(
              eq(schema.session.tokenHash, hashToken(token)),
              gt(schema.session.expiresAt, at),
              gt(schema.session.lastSeenAt, new Date(at.getTime() - SESSION_IDLE_MS)),
            ),
          );
        if (!row) return Option.none<Actor>();
        if (at.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
          yield* db
            .update(schema.session)
            .set({ lastSeenAt: at })
            .where(eq(schema.session.id, row.id));
        }
        const actor = yield* loadActor(db, row.tenantId, row.personId);
        return actor;
      });

      const revoke = Effect.fn('sessions.revoke')(function* (token: string) {
        yield* db.delete(schema.session).where(eq(schema.session.tokenHash, hashToken(token)));
      });

      return Sessions.of({ create, resolve, revoke });
    }),
  );
}

/** Loads the actor fresh on every request: person status and today's grants. */
export const loadActor = Effect.fn('actor.load')(function* (
  db: Db['Service'],
  tenantId: TenantId,
  personId: PersonId,
) {
  const [person] = yield* db
    .select()
    .from(schema.person)
    .where(and(eq(schema.person.tenantId, tenantId), eq(schema.person.id, personId)));
  if (!person || person.status === 'departed') return Option.none<Actor>();
  const on = yield* today;
  const grants = yield* db
    .select({ role: schema.roleGrant.role })
    .from(schema.roleGrant)
    .where(
      and(
        eq(schema.roleGrant.tenantId, tenantId),
        eq(schema.roleGrant.personId, personId),
        lte(schema.roleGrant.validFrom, on),
        or(isNull(schema.roleGrant.validTo), gt(schema.roleGrant.validTo, on)),
      ),
    );
  return Option.some<Actor>({
    tenantId,
    personId,
    displayName: person.displayName,
    grants: [...new Set(grants.map((g) => g.role as GrantRole))],
  });
});
