import { CurrentActor, Forbidden, type AdoptionView } from '@repo/api';
import { Db, schema } from '@repo/db';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import type { IsoDate } from '@repo/domain';
import {
  BusinessTimeZone,
  addDaysIso,
  now,
  startOfBusinessDay,
  today,
} from '../../platform/time.ts';
import { mondayOf } from '../shared/weeks.ts';

/**
 * The adoption view (ADR 0021): aggregates only, no names, no per-person
 * figures. Any cell computed from fewer than MIN_CELL people is null. It reads
 * facts and the outbox, and writes nothing.
 */
export const MIN_CELL = 5;
const WEEKS = 12;
const DAY = 86_400_000;

const quantile = (values: ReadonlyArray<number>, q: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
/** A share in [0, 1] to three decimals; null under the minimum cell. */
const share = (num: number, den: number) =>
  den >= MIN_CELL ? Math.round((1000 * num) / den) / 1000 : null;
// The action must FOLLOW the message: an action before it was sent is not a conversion.
const within = (action: Date | null, sentAt: Date) =>
  action !== null &&
  action.getTime() >= sentAt.getTime() &&
  action.getTime() <= sentAt.getTime() + 7 * DAY;
const cell = (n: number) => (n >= MIN_CELL ? n : null);
const bucket = (n: number) => (n >= 3 ? '3+' : String(n));
const LOAD_BUCKETS = [
  { label: '1–2', max: 2 },
  { label: '3–5', max: 5 },
  { label: '6–10', max: 10 },
  { label: '11+', max: Number.POSITIVE_INFINITY },
] as const;
const loadBucket = (n: number) => LOAD_BUCKETS.find((b) => n <= b.max)?.label ?? '11+';

/** Distinct observers per person (90 days) and observer load (28 days), as histograms. */
const distributions = (
  signed: ReadonlyArray<{ subjectId: string; observerId: string; signedAt: Date }>,
  planOwners: ReadonlySet<string>,
  at: Date,
) => {
  const since90 = new Date(at.getTime() - 90 * DAY);
  const observersPerPerson = [...planOwners].map(
    (id) =>
      new Set(
        signed.filter((o) => o.subjectId === id && o.signedAt >= since90).map((o) => o.observerId),
      ).size,
  );
  const distinctObservers = ['0', '1', '2', '3+'].map((b) => ({
    bucket: b,
    people: cell(observersPerPerson.filter((n) => bucket(n) === b).length),
  }));

  const loadCounts = new Map<string, number>();
  const since28 = new Date(at.getTime() - 28 * DAY);
  for (const o of signed.filter((x) => x.signedAt >= since28 && x.signedAt < at)) {
    loadCounts.set(o.observerId, (loadCounts.get(o.observerId) ?? 0) + 1);
  }
  const observerLoad = ['1–2', '3–5', '6–10', '11+'].map((b) => ({
    bucket: b,
    observers: cell([...loadCounts.values()].filter((n) => loadBucket(n) === b).length),
  }));

  return { distinctObservers, observerLoad };
};

export const buildAdoption = Effect.fn('hub.adoption')(function* () {
  const actor = yield* CurrentActor;
  if (!actor.grants.some((g) => g === 'program_owner' || g === 'tenant_admin')) {
    return yield* Effect.fail(
      new Forbidden({ message: 'The adoption view is for program owners.' }),
    );
  }
  const db = yield* Db;
  const at = yield* now;
  const on = yield* today;
  const firstWeek = addDaysIso(mondayOf(on), -7 * (WEEKS - 1));
  const tenant = actor.tenantId;
  const zone = yield* BusinessTimeZone;
  const dayStart = (d: IsoDate) => startOfBusinessDay(d, zone);
  const horizon = dayStart(addDaysIso(firstWeek, -90));

  const observations = yield* db
    .select({
      id: schema.observation.id,
      subjectId: schema.observation.subjectId,
      observerId: schema.observation.observerId,
      status: schema.observation.status,
      createdAt: schema.observation.createdAt,
      signedAt: schema.observation.signedAt,
      dueAt: schema.observation.dueAt,
      acknowledgedAt: schema.observation.acknowledgedAt,
      loggedAt: schema.interaction.createdAt,
      occurredOn: schema.interaction.occurredOn,
    })
    .from(schema.observation)
    .innerJoin(schema.interaction, eq(schema.interaction.id, schema.observation.interactionId))
    .where(
      and(eq(schema.observation.tenantId, tenant), gte(schema.observation.createdAt, horizon)),
    );
  const ratings = yield* db
    .select({
      observationId: schema.observationRating.observationId,
      credit: schema.observationRating.credit,
      level: schema.observationRating.level,
    })
    .from(schema.observationRating)
    .where(eq(schema.observationRating.tenantId, tenant));
  const credits = yield* db
    .select({
      observationId: schema.creditEntry.observationId,
      isFirstHand: schema.creditEntry.isFirstHand,
    })
    .from(schema.creditEntry)
    .where(eq(schema.creditEntry.tenantId, tenant));
  const reviews = yield* db
    .select({ entityId: schema.auditEvent.entityId })
    .from(schema.auditEvent)
    .where(
      and(
        eq(schema.auditEvent.tenantId, tenant),
        eq(schema.auditEvent.entityType, 'observation'),
        eq(schema.auditEvent.event, 'REQUEST_REVIEW'),
      ),
    );
  const withPlan = yield* db
    .selectDistinct({ ownerId: schema.plan.ownerId })
    .from(schema.plan)
    .where(
      and(eq(schema.plan.tenantId, tenant), inArray(schema.plan.status, ['active', 'paused'])),
    );
  const sent = yield* db
    .select()
    .from(schema.notification)
    .where(and(eq(schema.notification.tenantId, tenant), eq(schema.notification.status, 'sent')));

  const signed = observations.flatMap((o) => (o.signedAt ? [{ ...o, signedAt: o.signedAt }] : []));
  const signedIn = (from: Date, to: Date) =>
    signed.filter((o) => o.signedAt >= from && o.signedAt < to);
  const reviewed = new Set(reviews.map((r) => r.entityId));

  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const weekOf = addDaysIso(firstWeek, 7 * i);
    const from = dayStart(weekOf);
    const to = dayStart(addDaysIso(weekOf, 7));
    const inWeek = signedIn(from, to);
    const days = inWeek.map((o) => (o.signedAt.getTime() - o.loggedAt.getTime()) / DAY);
    const requested = observations.filter((o) => o.createdAt >= from && o.createdAt < to);
    const windowClosed = requested.every((o) => o.dueAt < at);
    return {
      weekOf,
      signed: inWeek.length,
      medianDaysToSign: days.length >= MIN_CELL ? round1(quantile(days, 0.5)) : null,
      p90DaysToSign: days.length >= MIN_CELL ? round1(quantile(days, 0.9)) : null,
      requested: requested.length,
      expiryRate: windowClosed
        ? share(requested.filter((o) => o.status === 'expired').length, requested.length)
        : null,
      activeObservers: cell(new Set(inWeek.map((o) => o.observerId)).size),
    };
  });

  // Coverage: people with an active plan observed (signed) for work in the last 42 days.
  const planOwners = new Set(withPlan.map((p) => p.ownerId));
  const since42 = addDaysIso(on, -42);
  const covered = new Set(
    signed
      .filter((o) => planOwners.has(o.subjectId) && o.occurredOn >= since42)
      .map((o) => o.subjectId),
  );

  // The last four complete weeks carry the shares, so a quiet week does not swing them.
  const recentFrom = dayStart(addDaysIso(mondayOf(on), -28));
  const recent = signedIn(recentFrom, dayStart(mondayOf(on)));
  const recentIds = new Set(recent.map((o) => o.id));
  const recentCredits = credits.filter((c) => recentIds.has(c.observationId));
  const recentRatings = ratings.filter((r) => recentIds.has(r.observationId) && r.level !== null);
  const recentRequested = observations.filter((o) => o.createdAt >= recentFrom && o.dueAt < at);

  const { distinctObservers, observerLoad } = distributions(signed, planOwners, at);

  // Conversion: an immediate notification whose awaited action followed within 7 days.
  const byId = new Map(observations.map((o) => [o.id as string, o]));
  const actionable = sent.filter(
    (n) =>
      (n.kind === 'observation_requested' ||
        n.kind === 'request_expiring' ||
        n.kind === 'observation_signed') &&
      n.sentAt !== null &&
      n.sentAt >= recentFrom &&
      // Only closed windows: a message sent in the last 7 days has not had its chance yet.
      n.sentAt.getTime() + 7 * DAY <= at.getTime(),
  );
  const converted = actionable.filter((n) => {
    const o = n.entityId ? byId.get(n.entityId) : undefined;
    if (!o || !n.sentAt) return false;
    return within(n.kind === 'observation_signed' ? o.acknowledgedAt : o.signedAt, n.sentAt);
  });

  return {
    asOf: on,
    minimumCell: MIN_CELL,
    weeks,
    coverage: { observed: cell(covered.size), withPlan: planOwners.size },
    expiryRate: share(
      recentRequested.filter((o) => o.status === 'expired').length,
      recentRequested.length,
    ),
    firstHandShare: share(recentCredits.filter((c) => c.isFirstHand).length, recentCredits.length),
    feedbackOnlyShare: share(recentRatings.filter((r) => !r.credit).length, recentRatings.length),
    acknowledgedShare: share(recent.filter((o) => o.acknowledgedAt !== null).length, recent.length),
    reviewRequestedShare: share(recent.filter((o) => reviewed.has(o.id)).length, recent.length),
    distinctObservers,
    observerLoad,
    notificationConversion: share(converted.length, actionable.length),
  } satisfies AdoptionView;
});
