import { Authenticated, CurrentActor, Unauthorized } from '@repo/api';
import { Db, schema } from '@repo/db';
import { eq } from 'drizzle-orm';
import { Effect, Layer, Option, Redacted } from 'effect';
import { BusinessTimeZone } from '../platform/time.ts';
import { Sessions } from './sessions.ts';

const unauthorized = new Unauthorized({ message: 'Please sign in.' });

/** Resolves the session cookie into the CurrentActor for every protected endpoint. */
export const AuthenticatedLive = Layer.effect(
  Authenticated,
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const db = yield* Db;
    // Tenants change zone rarely; a per-process cache saves a query per request.
    const zones = new Map<string, string>();
    const zoneOf = Effect.fn('auth.timeZone')(function* (tenantId: string) {
      const cached = zones.get(tenantId);
      if (cached) return cached;
      const [row] = yield* db
        .select({ timeZone: schema.tenant.timeZone })
        .from(schema.tenant)
        .where(eq(schema.tenant.id, tenantId as typeof schema.tenant.$inferSelect.id));
      const zone = row?.timeZone ?? BusinessTimeZone.defaultValue();
      zones.set(tenantId, zone);
      return zone;
    });
    return Authenticated.of({
      session: Effect.fn('auth.session')(function* (httpEffect, { credential }) {
        const token = Redacted.value(credential);
        if (token.length === 0) return yield* Effect.fail(unauthorized);
        const actor = yield* sessions.resolve(token).pipe(Effect.orDie);
        if (Option.isNone(actor)) return yield* Effect.fail(unauthorized);
        yield* Effect.annotateCurrentSpan({
          'user.id': actor.value.personId,
          'tenant.id': actor.value.tenantId,
        });
        const zone = yield* zoneOf(actor.value.tenantId).pipe(Effect.orDie);
        return yield* httpEffect.pipe(
          Effect.provideService(CurrentActor, actor.value),
          Effect.provideService(BusinessTimeZone, zone),
        );
      }),
    });
  }),
);
