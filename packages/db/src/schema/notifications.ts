import {
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_KINDS,
  NOTIFICATION_STATUSES,
  type IsoDate,
  type NotificationId,
  type NotificationKind,
  type PersonId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, instant, isoDate, oneOf, oneOfOrNull, tenantIdColumn } from './columns.ts';
import { personFk } from './directory.ts';

/**
 * Transactional outbox (ADR 0018). A row is written in the same transaction as
 * the audit event of the transition that makes something wait on a person; the
 * scheduler's dispatcher sends it later.
 *
 * Invariant I20: there is no free-text column. A message is rendered from the
 * closed `kind`, typed parameters (names looked up by id, a date, a count) and
 * a deep link, so narratives, levels, reflections, hold reasons and client
 * references cannot reach email.
 */
export const notification = pgTable(
  'notification',
  {
    id: text('id').$type<NotificationId>().primaryKey(),
    tenantId: tenantIdColumn(),
    recipientId: text('recipient_id').$type<PersonId>().notNull(),
    kind: text('kind').$type<NotificationKind>().notNull(),
    entityType: text('entity_type').notNull(),
    /** An opaque id; null for the digest. */
    entityId: text('entity_id'),
    actorId: text('actor_id').$type<PersonId>(),
    dueOn: isoDate('due_on').$type<IsoDate>(),
    itemCount: integer('item_count'),
    /** Idempotency: one row per (kind, entity, recipient[, period]). */
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').notNull().default('pending'),
    /** The transport that sent it (`email`, or `log` in development); set at dispatch. */
    channel: text('channel'),
    attempts: integer('attempts').notNull().default(0),
    sendAfter: instant('send_after').notNull().defaultNow(),
    sentAt: instant('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [
    personFk('notification_recipient_fk', t.tenantId, t.recipientId),
    personFk('notification_actor_fk', t.tenantId, t.actorId),
    oneOf('notification_kind_check', t.kind, NOTIFICATION_KINDS),
    oneOf('notification_entity_type_check', t.entityType, NOTIFICATION_ENTITY_TYPES),
    oneOf('notification_status_check', t.status, NOTIFICATION_STATUSES),
    oneOfOrNull('notification_channel_check', t.channel, ['email', 'log']),
    check(
      'notification_entity_shape',
      sql`(${t.entityType} = 'digest') = (${t.entityId} is null) and (${t.entityId} is null or ${t.entityId} ~ '^[a-z]{3}_[0-9a-z]+$')`,
    ),
    check('notification_dedupe_key_shape', sql`${t.dedupeKey} ~ '^[a-z_]+(:[0-9a-z_-]+)+$'`),
    check(
      'notification_item_count',
      sql`${t.itemCount} is null or ${t.itemCount} between 0 and 999`,
    ),
    check('notification_sent_shape', sql`(${t.status} = 'sent') = (${t.sentAt} is not null)`),
    check('notification_attempts', sql`${t.attempts} between 0 and 20`),
    uniqueIndex('notification_dedupe_unique').on(t.tenantId, t.dedupeKey),
    index('notification_dispatch_idx').on(t.status, t.sendAfter),
    index('notification_recipient_idx').on(t.tenantId, t.recipientId, t.createdAt),
  ],
);
