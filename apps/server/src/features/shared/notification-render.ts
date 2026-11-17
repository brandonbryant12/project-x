import type { IsoDate, NotificationKind } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { Settings } from '../../platform/settings.ts';
import { digestCounts } from './notification-digest.ts';
import {
  deepLink,
  renderDigest,
  renderNotification,
  type Rendered,
} from './notification-templates.ts';
import { firstName } from './people.ts';

type Row = typeof schema.notification.$inferSelect;

/** The exact message a row renders to, or null when there is nothing to say. */
export const renderRow = Effect.fn('notifications.render')(function* (row: Row, at: Date) {
  const db = yield* Db;
  const settings = yield* Settings;
  const ids = [row.recipientId, ...(row.actorId ? [row.actorId] : [])];
  const people = yield* db
    .select({
      id: schema.person.id,
      displayName: schema.person.displayName,
      email: schema.person.email,
    })
    .from(schema.person)
    .where(and(eq(schema.person.tenantId, row.tenantId), inArray(schema.person.id, ids)));
  const recipient = people.find((p) => p.id === row.recipientId);
  if (!recipient) return null;
  const actor = people.find((p) => p.id === row.actorId) ?? null;
  const kind = row.kind as NotificationKind;
  let ownerId: string | undefined;
  if (kind === 'plan_proposed' && row.entityId) {
    const [plan] = yield* db
      .select({ ownerId: schema.plan.ownerId })
      .from(schema.plan)
      .where(
        eq(schema.plan.id, row.entityId as Row['entityId'] & typeof schema.plan.$inferSelect.id),
      );
    ownerId = plan?.ownerId;
  }
  const link = deepLink(settings.appOrigin, kind, row.entityId, { ...(ownerId && { ownerId }) });
  let rendered: Rendered | null;
  if (kind === 'weekly_digest') {
    const counts = yield* digestCounts(row.tenantId, row.recipientId, row.dueOn as IsoDate, at);
    rendered = renderDigest(firstName(recipient.displayName), counts, link);
  } else {
    rendered = renderNotification(kind, {
      firstName: firstName(recipient.displayName),
      actorName: actor?.displayName ?? null,
      dueOn: row.dueOn,
      link,
    });
  }
  return rendered ? { rendered, recipient } : null;
});
