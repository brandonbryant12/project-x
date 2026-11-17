import { CurrentActor, Forbidden, type OutboxRow } from '@repo/api';
import type { NotificationKind } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { desc, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { renderRow } from '../shared/notification-render.ts';
import { loadPeople, personFrom } from '../shared/people.ts';

/**
 * What the outbox sent, rendered exactly as delivered (ADR 0018). Tenant
 * admins only; the read is audited like the other admin reads (ADR 0015).
 */
export const listOutbox = Effect.fn('hub.outbox')(function* (limit: number | undefined) {
  const actor = yield* CurrentActor;
  if (!actor.grants.includes('tenant_admin')) {
    return yield* Effect.fail(new Forbidden({ message: 'The outbox is for tenant admins.' }));
  }
  const db = yield* Db;
  const at = yield* now;
  const rows = yield* db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.tenantId, actor.tenantId))
    .orderBy(desc(schema.notification.createdAt))
    .limit(Math.min(limit ?? 100, 500));
  const people = yield* loadPeople(
    actor.tenantId,
    rows.map((r) => r.recipientId),
  );
  yield* recordAudit(actor, {
    entityType: 'outbox',
    entityId: actor.tenantId,
    event: 'READ_OUTBOX',
  });
  const result: Array<OutboxRow> = [];
  for (const row of rows) {
    const message = yield* renderRow(row, at);
    result.push({
      kind: row.kind as NotificationKind,
      recipient: personFrom(people, row.recipientId),
      status: row.status as OutboxRow['status'],
      channel: row.channel,
      rendered: message?.rendered ?? { subject: '(nothing to say; skipped)', lines: [], link: '' },
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
    });
  }
  return result;
});
