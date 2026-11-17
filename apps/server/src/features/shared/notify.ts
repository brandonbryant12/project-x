import type { NotificationPreferences } from '@repo/api';
import {
  NotificationId,
  type IsoDate,
  type NotificationKind,
  type PersonId,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { Effect } from 'effect';
import { now } from '../../platform/time.ts';

/**
 * Enqueue a notification in the outbox (ADR 0018). Call it inside the same
 * transaction as the audit event of the transition that makes something wait
 * on `recipientId`, so a rolled-back transition never notifies anyone.
 *
 * Invariant I20: only ids, a date and a count go in. Words come from the
 * closed templates at send time; there is nowhere to put free text.
 */
export interface NotificationInput {
  readonly recipientId: PersonId;
  readonly kind: Exclude<NotificationKind, 'weekly_digest'>;
  readonly entityType: 'observation' | 'plan' | 'engagement';
  readonly entityId: string;
  readonly actorId: PersonId | null;
  readonly dueOn?: IsoDate | null;
  /** Distinguishes repeats of the same kind on one entity (e.g. a second RETURN). */
  readonly occurrence?: string;
  readonly sendAfter?: Date;
}

export const notify = Effect.fn('notifications.enqueue')(function* (
  tenantId: TenantId,
  input: NotificationInput,
) {
  if (input.actorId === input.recipientId) return;
  const db = yield* Db;
  const parts = [input.kind, input.entityId.toLowerCase(), input.recipientId.toLowerCase()];
  if (input.occurrence) parts.push(input.occurrence);
  yield* db
    .insert(schema.notification)
    .values({
      id: NotificationId.generate(),
      tenantId,
      recipientId: input.recipientId,
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId,
      dueOn: input.dueOn ?? null,
      dedupeKey: parts.join(':'),
      // From the Effect clock, so scenario tests and seeds replay honestly.
      sendAfter: input.sendAfter ?? (yield* now),
    })
    .onConflictDoNothing();
});

/** No preference row means these (ADR 0018): email, weekly digest on. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  channel: 'email',
  weeklyDigest: true,
};
