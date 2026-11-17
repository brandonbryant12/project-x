import type { PersonId } from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';
import { Effect, Layer, Schedule } from 'effect';
import { Notifier } from '../../platform/notifier.ts';
import { Settings } from '../../platform/settings.ts';
import { businessDateIn, now } from '../../platform/time.ts';
import { DEFAULT_PREFERENCES, notify } from '../shared/notify.ts';
import { tenantTimeZone } from '../shared/business-date.ts';
import { enqueueDigests, localClock } from '../shared/notification-digest.ts';
import { renderRow } from '../shared/notification-render.ts';

/**
 * Outbox dispatcher (ADR 0018). Each row is claimed with FOR UPDATE SKIP
 * LOCKED in its own short transaction, so replicas never send the same row
 * twice; the dedupe key already prevents duplicate rows. A failed send backs
 * off and is retried up to MAX_ATTEMPTS, then marked failed.
 */
export const MAX_ATTEMPTS = 5;
const BATCH = 50;

type Row = typeof schema.notification.$inferSelect;

/** The digest goes out Monday morning only; a late dispatcher skips it rather than send at night. */
const DIGEST_WINDOW_END_MINUTES = 12 * 60;

/** Whether the thing a row announces is still the case at `at` (ADR 0018). */
const stillTrue = Effect.fn('notifications.stillTrue')(function* (row: Row, at: Date) {
  const db = yield* Db;
  if (row.kind === 'weekly_digest') {
    const zone = yield* tenantTimeZone(row.tenantId);
    const local = localClock(at, zone);
    return local.date === row.dueOn && local.minutes < DIGEST_WINDOW_END_MINUTES;
  }
  if (row.entityId === null) return false;
  if (row.entityType === 'observation') {
    const [o] = yield* db
      .select({ status: schema.observation.status, dueAt: schema.observation.dueAt })
      .from(schema.observation)
      .where(eq(schema.observation.id, row.entityId as typeof schema.observation.$inferSelect.id));
    if (!o) return false;
    if (row.kind === 'observation_signed')
      return o.status === 'signed' || o.status === 'under_review';
    if (row.kind === 'observation_returned') return o.status === 'returned';
    return (o.status === 'requested' || o.status === 'drafting') && o.dueAt > at;
  }
  if (row.entityType === 'plan') {
    const [p] = yield* db
      .select({ status: schema.plan.status })
      .from(schema.plan)
      .where(eq(schema.plan.id, row.entityId as typeof schema.plan.$inferSelect.id));
    return p?.status === 'proposed';
  }
  const [e] = yield* db
    .select({ status: schema.engagement.status })
    .from(schema.engagement)
    .where(eq(schema.engagement.id, row.entityId as typeof schema.engagement.$inferSelect.id));
  return e?.status === 'proposed';
});

const dispatchOne = Effect.fn('notifications.dispatchOne')(function* (at: Date) {
  const db = yield* Db;
  const notifier = yield* Notifier;
  return yield* transactionally(
    Effect.gen(function* () {
      const [row] = yield* db
        .select()
        .from(schema.notification)
        .where(
          and(eq(schema.notification.status, 'pending'), lte(schema.notification.sendAfter, at)),
        )
        .orderBy(asc(schema.notification.sendAfter))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return false;
      const [pref] = yield* db
        .select()
        .from(schema.notificationPreference)
        .where(eq(schema.notificationPreference.personId, row.recipientId));
      const sendEmail = pref ? pref.channel !== 'off' : DEFAULT_PREFERENCES.sendEmail;
      const finish = (set: Partial<typeof schema.notification.$inferInsert>) =>
        db.update(schema.notification).set(set).where(eq(schema.notification.id, row.id));
      if (!sendEmail) {
        yield* finish({ status: 'skipped' });
        return true;
      }
      // Never send something that stopped being true while the row waited.
      if (!(yield* stillTrue(row, at))) {
        yield* finish({ status: 'skipped' });
        return true;
      }
      const message = yield* renderRow(row, at);
      if (message === null) {
        yield* finish({ status: 'skipped' });
        return true;
      }
      // Email is the only channel; an old Teams choice is delivered by email too.
      const transport = notifier.transport === 'log' ? 'log' : 'email';
      const sent = yield* notifier
        .send({
          channel: transport,
          to: { personId: message.recipient.id, email: message.recipient.email },
          ...message.rendered,
        })
        .pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );
      if (sent) {
        yield* finish({
          status: 'sent',
          sentAt: at,
          channel: transport,
          attempts: row.attempts + 1,
        });
      } else {
        const attempts = row.attempts + 1;
        yield* finish(
          attempts >= MAX_ATTEMPTS
            ? { status: 'failed', attempts }
            : { attempts, sendAfter: new Date(at.getTime() + 2 ** attempts * 60_000) },
        );
      }
      return true;
    }),
  );
});

/** Requests whose window closes within 48 hours remind the observer once. */
export const enqueueExpiryReminders = Effect.fn('notifications.expiring')(function* (at: Date) {
  const db = yield* Db;
  const soon = new Date(at.getTime() + 48 * 3_600_000);
  const rows = yield* db
    .select()
    .from(schema.observation)
    .where(
      and(
        // Waiting on the observer, and someone asked: a returned request waits on its
        // subject, and an observer's own "I saw this" draft has nobody waiting.
        inArray(schema.observation.status, ['requested', 'drafting']),
        gt(schema.observation.dueAt, at),
        lte(schema.observation.dueAt, soon),
      ),
    );
  for (const o of rows.filter((r) => r.requestedById !== r.observerId)) {
    const zone = yield* tenantTimeZone(o.tenantId);
    yield* notify(o.tenantId, {
      recipientId: o.observerId,
      kind: 'request_expiring',
      entityType: 'observation',
      entityId: o.id,
      actorId: o.subjectId as PersonId,
      dueOn: businessDateIn(o.dueAt, zone),
    });
  }
  return rows.length;
});

export const runNotifications = Effect.fn('notifications.run')(function* () {
  const at = yield* now;
  yield* enqueueExpiryReminders(at);
  yield* enqueueDigests(at);
  let sent = 0;
  while (sent < BATCH && (yield* dispatchOne(at))) sent++;
  return sent;
});

export const NotificationsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* Settings;
    if (!settings.schedulerEnabled) return;
    yield* runNotifications().pipe(
      Effect.catchCause((cause) => Effect.logError('notification dispatch failed', cause)),
      Effect.repeat(Schedule.spaced('1 minute')),
      Effect.forkScoped,
    );
  }),
);
