import type { PersonId } from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';
import { Effect, Layer, Schedule } from 'effect';
import { Notifier, type OutgoingMessage } from '../../platform/notifier.ts';
import { Settings } from '../../platform/settings.ts';
import { businessDateIn, now } from '../../platform/time.ts';
import { DEFAULT_PREFERENCES, notify } from '../shared/notify.ts';
import { tenantTimeZone } from '../shared/business-date.ts';
import { enqueueDigests, localClock } from '../shared/notification-digest.ts';
import { renderRow } from '../shared/notification-render.ts';

/**
 * Outbox dispatcher (ADR 0018). Each row goes through three steps, and no
 * database transaction is open while the transport runs:
 *
 *  1. Claim, in a short transaction: lock one due pending row with FOR UPDATE
 *     SKIP LOCKED, finish the skip cases there, otherwise count the attempt and
 *     lease the row by pushing `send_after` CLAIM_LEASE_MS ahead, then commit.
 *     Another dispatcher cannot pick the row up until the lease ends.
 *  2. Send, outside any transaction, cut off after SEND_TIMEOUT_MS.
 *  3. Acknowledge, in one fenced update: mark it sent, or back off, or mark it
 *     failed after MAX_ATTEMPTS. The update applies only while the row is still
 *     pending at the attempt this dispatcher claimed, so a sender whose lease
 *     ran out never overwrites a row another dispatcher has since finished.
 *
 * Delivery is at least once. If the process dies (or the acknowledgement is
 * lost) after the transport accepted a message, the row becomes due again when
 * the lease ends and is sent again. The dedupe key prevents duplicate rows, not
 * that duplicate send. A row that keeps being claimed and never acknowledged is
 * marked failed at its next claim once it has used MAX_ATTEMPTS.
 */
export const MAX_ATTEMPTS = 5;
/** How long a claim holds a row before another dispatcher may take it over. */
export const CLAIM_LEASE_MS = 10 * 60_000;
/** A send still running after this is a failed attempt. Well inside the lease. */
export const SEND_TIMEOUT_MS = 60_000;
const BATCH = 50;

/** Minutes to wait after failed attempt `n` (1-based) before the next try. */
const backoffMs = (attempt: number) => 2 ** attempt * 60_000;

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
      .where(
        and(
          eq(schema.observation.tenantId, row.tenantId),
          eq(schema.observation.id, row.entityId as typeof schema.observation.$inferSelect.id),
        ),
      );
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
      .where(
        and(
          eq(schema.plan.tenantId, row.tenantId),
          eq(schema.plan.id, row.entityId as typeof schema.plan.$inferSelect.id),
        ),
      );
    return p?.status === 'proposed';
  }
  const [e] = yield* db
    .select({ status: schema.engagement.status })
    .from(schema.engagement)
    .where(
      and(
        eq(schema.engagement.tenantId, row.tenantId),
        eq(schema.engagement.id, row.entityId as typeof schema.engagement.$inferSelect.id),
      ),
    );
  return e?.status === 'proposed';
});

type Claim =
  | { readonly _tag: 'empty' }
  | { readonly _tag: 'finished' }
  | {
      readonly _tag: 'claimed';
      readonly id: Row['id'];
      /** The attempt this claim counted; the acknowledgement is fenced on it. */
      readonly attempt: number;
      readonly message: OutgoingMessage;
    };

/** Step 1: claim one due row in a short transaction, with a fresh clock. */
const claimOne = Effect.fn('notifications.claim')(function* () {
  const db = yield* Db;
  const notifier = yield* Notifier;
  return yield* transactionally(
    Effect.gen(function* () {
      const at = yield* now;
      const [row] = yield* db
        .select()
        .from(schema.notification)
        .where(
          and(eq(schema.notification.status, 'pending'), lte(schema.notification.sendAfter, at)),
        )
        .orderBy(asc(schema.notification.sendAfter))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return { _tag: 'empty' } as Claim;
      const finish = (set: Partial<typeof schema.notification.$inferInsert>) =>
        db
          .update(schema.notification)
          .set(set)
          .where(
            and(eq(schema.notification.tenantId, row.tenantId), eq(schema.notification.id, row.id)),
          );
      // Every attempt was claimed and none acknowledged (repeated crashes or hangs).
      // Counting another would exceed the limit; stop here instead of looping forever.
      if (row.attempts >= MAX_ATTEMPTS) {
        yield* finish({ status: 'failed' });
        yield* Effect.logWarning('notification failed: never acknowledged', {
          kind: row.kind,
          attempts: row.attempts,
        });
        return { _tag: 'finished' } as Claim;
      }
      const [pref] = yield* db
        .select()
        .from(schema.notificationPreference)
        .where(
          and(
            eq(schema.notificationPreference.tenantId, row.tenantId),
            eq(schema.notificationPreference.personId, row.recipientId),
          ),
        );
      const sendEmail = pref ? pref.channel !== 'off' : DEFAULT_PREFERENCES.sendEmail;
      // Never send something that stopped being true while the row waited.
      const message = sendEmail && (yield* stillTrue(row, at)) ? yield* renderRow(row, at) : null;
      if (message === null) {
        yield* finish({ status: 'skipped' });
        return { _tag: 'finished' } as Claim;
      }
      const attempt = row.attempts + 1;
      yield* finish({ attempts: attempt, sendAfter: new Date(at.getTime() + CLAIM_LEASE_MS) });
      // Email is the only channel; an old Teams choice is delivered by email too.
      const channel = notifier.transport === 'log' ? 'log' : 'email';
      return {
        _tag: 'claimed',
        id: row.id,
        attempt,
        message: {
          channel,
          to: { personId: message.recipient.id, email: message.recipient.email },
          ...message.rendered,
        },
      } as Claim;
    }),
  );
});

/** Step 3: record the outcome, only if the row is still ours (pending at our attempt). */
const acknowledge = Effect.fn('notifications.acknowledge')(function* (
  claim: Extract<Claim, { _tag: 'claimed' }>,
  sent: boolean,
) {
  const db = yield* Db;
  const at = yield* now;
  let set: Partial<typeof schema.notification.$inferInsert>;
  if (sent) set = { status: 'sent', sentAt: at, channel: claim.message.channel };
  else if (claim.attempt >= MAX_ATTEMPTS) set = { status: 'failed' };
  else set = { sendAfter: new Date(at.getTime() + backoffMs(claim.attempt)) };
  const updated = yield* db
    .update(schema.notification)
    .set(set)
    .where(
      and(
        eq(schema.notification.id, claim.id),
        eq(schema.notification.status, 'pending'),
        eq(schema.notification.attempts, claim.attempt),
      ),
    )
    .returning({ id: schema.notification.id });
  if (updated.length === 0) {
    // The lease ran out and another dispatcher took the row over; its outcome stands.
    yield* Effect.logWarning('notification acknowledgement superseded', {
      attempt: claim.attempt,
      sent,
    });
  }
});

/** Claims, sends and acknowledges one row. False when nothing is due. */
const dispatchOne = Effect.fn('notifications.dispatchOne')(function* () {
  const notifier = yield* Notifier;
  const claim = yield* claimOne();
  if (claim._tag === 'empty') return false;
  if (claim._tag === 'finished') return true;
  // Step 2: no transaction is open here; a slow relay holds no lock and no connection.
  const sent = yield* notifier.send(claim.message).pipe(
    Effect.timeout(SEND_TIMEOUT_MS),
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );
  yield* acknowledge(claim, sent);
  return true;
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

/** Enqueues what is due, then dispatches up to BATCH rows. Returns the rows handled. */
export const runNotifications = Effect.fn('notifications.run')(function* () {
  const at = yield* now;
  yield* enqueueExpiryReminders(at);
  yield* enqueueDigests(at);
  let handled = 0;
  // Each claim reads the clock again: a lease computed from the batch's start
  // could already have run out by the time it is written.
  while (handled < BATCH && (yield* dispatchOne())) handled++;
  return handled;
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
