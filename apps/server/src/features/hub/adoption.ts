import { CurrentActor, Forbidden, type AdoptionView } from '@repo/api';
import { Db, schema } from '@repo/db';
import { and, eq, gte, lt } from 'drizzle-orm';
import { Effect } from 'effect';
import {
  BusinessTimeZone,
  addDaysIso,
  now,
  startOfBusinessDay,
  today,
} from '../../platform/time.ts';
import { MIN_CELL, planCoverage } from '../shared/program.ts';
import { mondayOf } from '../shared/weeks.ts';

/**
 * The adoption view (ADR 0021): four numbers, aggregates only, no names, no
 * per-person figures. Any figure drawn from fewer than MIN_CELL is null. It
 * reads facts and writes nothing.
 */
const DAY = 86_400_000;

const median = (values: ReadonlyArray<number>) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length / 2) - 1)] ?? 0;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

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
  const zone = yield* BusinessTimeZone;
  const tenant = actor.tenantId;
  // The last four complete business weeks, so a quiet week does not swing the figures.
  const thisWeek = mondayOf(on);
  const from = startOfBusinessDay(addDaysIso(thisWeek, -28), zone);
  const to = startOfBusinessDay(thisWeek, zone);

  const coverage = yield* planCoverage(tenant, on);
  const [signed, requested] = yield* Effect.all([
    db
      .select({
        signedAt: schema.observation.signedAt,
        loggedAt: schema.interaction.createdAt,
      })
      .from(schema.observation)
      .innerJoin(schema.interaction, eq(schema.interaction.id, schema.observation.interactionId))
      .where(
        and(
          eq(schema.observation.tenantId, tenant),
          gte(schema.observation.signedAt, from),
          lt(schema.observation.signedAt, to),
        ),
      ),
    db
      .select({ status: schema.observation.status, dueAt: schema.observation.dueAt })
      .from(schema.observation)
      .where(and(eq(schema.observation.tenantId, tenant), gte(schema.observation.createdAt, from))),
  ]);

  const days = signed.flatMap((o) =>
    o.signedAt ? [(o.signedAt.getTime() - o.loggedAt.getTime()) / DAY] : [],
  );
  // Only requests whose signing window has closed can have expired.
  const closed = requested.filter((o) => o.dueAt < at);
  const expired = closed.filter((o) => o.status === 'expired').length;

  return {
    asOf: on,
    minimumCell: MIN_CELL,
    withPlan: coverage.withPlan,
    observedRecently: coverage.observed,
    medianDaysToSign: days.length >= MIN_CELL ? round1(median(days)) : null,
    expiryRate:
      closed.length >= MIN_CELL ? Math.round((1000 * expired) / closed.length) / 1000 : null,
  } satisfies AdoptionView;
});
