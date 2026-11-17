import type { TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';

export const tenantTimeZone = Effect.fn('tenant.timeZone')(function* (tenantId: TenantId) {
  const db = yield* Db;
  const [row] = yield* db
    .select({ timeZone: schema.tenant.timeZone })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, tenantId));
  return row?.timeZone ?? 'UTC';
});
