import {
  NotificationId,
  directReportsOf,
  type IsoDate,
  type PersonId,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDaysIso, businessDateIn, startOfBusinessDay } from '../../platform/time.ts';
import { tenantTimeZone } from './business-date.ts';
import type { DigestCounts } from './notification-templates.ts';
import { loadRelationshipFacts } from './relationships.ts';

/**
 * The Monday digest's numbers, computed at send time from facts (ADR 0018).
 * Nothing about the digest is stored except that it is due.
 */
export const digestCounts = Effect.fn('digest.counts')(function* (
  tenantId: TenantId,
  personId: PersonId,
  weekOf: IsoDate,
  at: Date,
) {
  const db = yield* Db;
  const weekEnd = addDaysIso(weekOf, 7);
  const toSign = yield* db
    .select({ dueAt: schema.observation.dueAt })
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.tenantId, tenantId),
        eq(schema.observation.observerId, personId),
        inArray(schema.observation.status, ['requested', 'drafting']),
      ),
    );
  const zone = yield* tenantTimeZone(tenantId);
  const earliest = toSign.map((r) => businessDateIn(r.dueAt, zone)).toSorted()[0] ?? null;
  const planned = yield* db
    .selectDistinct({ ownerId: schema.activity.ownerId })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.tenantId, tenantId),
        eq(schema.activity.intendedObserverId, personId),
        inArray(schema.activity.status, ['planned', 'underway']),
        gte(schema.activity.dueOn, weekOf),
        lt(schema.activity.dueOn, weekEnd),
      ),
    );
  const weekAgo = new Date(at.getTime() - 7 * 86_400_000);
  const newAboutYou = yield* db
    .select({ id: schema.observation.id })
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.tenantId, tenantId),
        eq(schema.observation.subjectId, personId),
        eq(schema.observation.status, 'signed'),
        gte(schema.observation.signedAt, weekAgo),
        isNull(schema.observation.acknowledgedAt),
      ),
    );
  const conversations = yield* db
    .select({ id: schema.coachingConversation.id })
    .from(schema.coachingConversation)
    .where(
      and(
        eq(schema.coachingConversation.tenantId, tenantId),
        eq(schema.coachingConversation.status, 'scheduled'),
        or(
          eq(schema.coachingConversation.hostId, personId),
          eq(schema.coachingConversation.coacheeId, personId),
        ),
        gte(schema.coachingConversation.scheduledFor, startOfBusinessDay(weekOf, zone)),
        lt(schema.coachingConversation.scheduledFor, startOfBusinessDay(weekEnd, zone)),
      ),
    );
  const commitments = yield* db
    .select({ id: schema.commitment.id })
    .from(schema.commitment)
    .where(
      and(
        eq(schema.commitment.tenantId, tenantId),
        eq(schema.commitment.ownerId, personId),
        eq(schema.commitment.status, 'open'),
        gte(schema.commitment.dueOn, weekOf),
        lt(schema.commitment.dueOn, weekEnd),
      ),
    );
  const facts = yield* loadRelationshipFacts(tenantId);
  const reports = directReportsOf(facts, personId, weekOf);
  let reportsObserved: DigestCounts['reportsObserved'] = null;
  if (reports.length > 0) {
    const since = new Date(at.getTime() - 42 * 86_400_000);
    const observed = yield* db
      .selectDistinct({ subjectId: schema.observation.subjectId })
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.tenantId, tenantId),
          inArray(schema.observation.subjectId, [...reports]),
          inArray(schema.observation.status, ['signed', 'under_review']),
          gte(schema.observation.signedAt, since),
        ),
      );
    reportsObserved = { observed: observed.length, of: reports.length };
  }
  return {
    toSign: toSign.length,
    earliestDue: earliest,
    plannedForYou: planned.length,
    newAboutYou: newAboutYou.length,
    conversationsThisWeek: conversations.length,
    commitmentsDue: commitments.length,
    reportsObserved,
  } satisfies DigestCounts;
});

/** The tenant-local weekday (0 = Sunday), date and minutes past midnight at `at`. */
export const localClock = (at: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? '');
  return {
    weekday,
    date: `${parts.year}-${parts.month}-${parts.day}` as IsoDate,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

export const DIGEST_LOCAL_MINUTES = 7 * 60 + 30;

/** Monday 07:30 tenant time: one digest row per person per week (dedupe key). */
export const enqueueDigests = Effect.fn('digest.enqueue')(function* (at: Date) {
  const db = yield* Db;
  const tenants = yield* db.select().from(schema.tenant);
  let enqueued = 0;
  for (const tenant of tenants) {
    const local = localClock(at, tenant.timeZone);
    if (local.weekday !== 1 || local.minutes < DIGEST_LOCAL_MINUTES) continue;
    const [already] = yield* db
      .select({ id: schema.notification.id })
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.tenantId, tenant.id),
          eq(schema.notification.kind, 'weekly_digest'),
          eq(schema.notification.dueOn, local.date),
        ),
      )
      .limit(1);
    if (already) continue;
    const people = yield* db
      .select({ id: schema.person.id })
      .from(schema.person)
      .leftJoin(
        schema.notificationPreference,
        eq(schema.notificationPreference.personId, schema.person.id),
      )
      .where(
        and(
          eq(schema.person.tenantId, tenant.id),
          eq(schema.person.status, 'active'),
          or(
            isNull(schema.notificationPreference.personId),
            eq(schema.notificationPreference.weeklyDigest, true),
          ),
        ),
      );
    if (people.length === 0) continue;
    yield* db
      .insert(schema.notification)
      .values(
        people.map((p) => ({
          id: NotificationId.generate(),
          tenantId: tenant.id,
          recipientId: p.id,
          kind: 'weekly_digest' as const,
          entityType: 'digest',
          entityId: null,
          dueOn: local.date,
          dedupeKey: `weekly_digest:${p.id.toLowerCase()}:${local.date}`,
          sendAfter: at,
        })),
      )
      .onConflictDoNothing();
    enqueued += people.length;
  }
  return enqueued;
});
