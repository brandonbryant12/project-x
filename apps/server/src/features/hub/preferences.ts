import { CurrentActor, type NotificationPreferences } from '@repo/api';
import type { PersonId, TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { DEFAULT_PREFERENCES } from '../shared/notify.ts';

export const preferencesOf = Effect.fn('preferences.of')(function* (
  tenantId: TenantId,
  personId: PersonId,
) {
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.notificationPreference)
    .where(
      and(
        eq(schema.notificationPreference.tenantId, tenantId),
        eq(schema.notificationPreference.personId, personId),
      ),
    );
  return row
    ? ({
        channel: row.channel,
        weeklyDigest: row.weeklyDigest,
        observeCapacity: row.observeCapacity,
      } as NotificationPreferences)
    : DEFAULT_PREFERENCES;
});

export const myPreferences = Effect.gen(function* () {
  const actor = yield* CurrentActor;
  return yield* preferencesOf(actor.tenantId, actor.personId);
});

export const updatePreferences = Effect.fn('preferences.update')(function* (
  input: NotificationPreferences,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  yield* db
    .insert(schema.notificationPreference)
    .values({ tenantId: actor.tenantId, personId: actor.personId, ...input })
    .onConflictDoUpdate({
      target: schema.notificationPreference.personId,
      set: { ...input, updatedAt: new Date() },
    });
  return yield* preferencesOf(actor.tenantId, actor.personId);
});
