import { CurrentActor, Forbidden, type AdoptionView } from '@repo/api';
import type { TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { Effect } from 'effect';
import {
  BusinessTimeZone,
  addDaysIso,
  now,
  startOfBusinessDay,
  today,
} from '../../platform/time.ts';
import {
  MIN_CELL,
  STANDING_SIGNED,
  cell,
  distinctPeople,
  planCoverage,
} from '../shared/program.ts';
import { mondayOf } from '../shared/weeks.ts';

/**
 * The adoption view (ADR 0021): four numbers, aggregates only, no names, no
 * per-person figures. Suppression counts distinct people, never events: each
 * figure is null unless it draws on at least MIN_CELL people, where the person
 * behind an observation is its subject (the person whose work it was). Voided
 * observations count for nothing. It reads facts and writes nothing.
 */
const DAY = 86_400_000;

const median = (values: ReadonlyArray<number>) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length / 2) - 1)] ?? 0;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

interface SignedRow {
  readonly subjectId: string;
  readonly signedAt: Date | null;
  readonly loggedAt: Date;
}
interface RequestRow {
  readonly subjectId: string;
  readonly status: string;
  readonly dueAt: Date;
}

/**
 * The observations behind the last two figures, over [from, to): signatures
 * that stand (a voided observation is left out), and requests made in the
 * period that were not voided.
 */
export const adoptionRows = Effect.fn('hub.adoptionRows')(function* (
  tenantId: TenantId,
  from: Date,
  to: Date,
) {
  const db = yield* Db;
  const [signed, requested] = yield* Effect.all([
    db
      .select({
        subjectId: schema.observation.subjectId,
        signedAt: schema.observation.signedAt,
        loggedAt: schema.interaction.createdAt,
      })
      .from(schema.observation)
      .innerJoin(
        schema.interaction,
        and(
          eq(schema.interaction.tenantId, schema.observation.tenantId),
          eq(schema.interaction.id, schema.observation.interactionId),
        ),
      )
      .where(
        and(
          eq(schema.observation.tenantId, tenantId),
          inArray(schema.observation.status, [...STANDING_SIGNED]),
          gte(schema.observation.signedAt, from),
          lt(schema.observation.signedAt, to),
        ),
      ),
    db
      .select({
        subjectId: schema.observation.subjectId,
        status: schema.observation.status,
        dueAt: schema.observation.dueAt,
      })
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.tenantId, tenantId),
          gte(schema.observation.createdAt, from),
          ne(schema.observation.status, 'voided'),
        ),
      ),
  ]);
  return { signed, requested };
});

/**
 * Median days to sign and the expiry rate, each withheld unless the
 * observations behind it are about at least MIN_CELL distinct people.
 */
export const timingFigures = (
  rows: {
    readonly signed: ReadonlyArray<SignedRow>;
    readonly requested: ReadonlyArray<RequestRow>;
  },
  at: Date,
) => {
  const days = rows.signed.flatMap((o) =>
    o.signedAt ? [(o.signedAt.getTime() - o.loggedAt.getTime()) / DAY] : [],
  );
  // Only requests whose signing window has closed can have expired.
  const closed = rows.requested.filter((o) => o.dueAt < at);
  const expired = closed.filter((o) => o.status === 'expired').length;
  return {
    medianDaysToSign: cell(distinctPeople(rows.signed)) === null ? null : round1(median(days)),
    expiryRate:
      cell(distinctPeople(closed)) === null
        ? null
        : Math.round((1000 * expired) / closed.length) / 1000,
  };
};

export const buildAdoption = Effect.fn('hub.adoption')(function* () {
  const actor = yield* CurrentActor;
  if (!actor.grants.some((g) => g === 'program_owner' || g === 'tenant_admin')) {
    return yield* Effect.fail(
      new Forbidden({ message: 'The adoption view is for program owners.' }),
    );
  }
  const at = yield* now;
  const on = yield* today;
  const zone = yield* BusinessTimeZone;
  // The last four complete business weeks, so a quiet week does not swing the figures.
  const thisWeek = mondayOf(on);
  const from = startOfBusinessDay(addDaysIso(thisWeek, -28), zone);
  const to = startOfBusinessDay(thisWeek, zone);

  const coverage = yield* planCoverage(actor.tenantId, on);
  const timing = timingFigures(yield* adoptionRows(actor.tenantId, from, to), at);
  return {
    asOf: on,
    minimumCell: MIN_CELL,
    withPlan: coverage.withPlan,
    observedRecently: coverage.observed,
    ...timing,
  } satisfies AdoptionView;
});
