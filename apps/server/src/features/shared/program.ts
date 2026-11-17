import type { IsoDate, TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDaysIso } from '../../platform/time.ts';

/**
 * Program figures (ADR 0021): aggregates only, never names. Suppression counts
 * distinct people, never events: a figure is withheld (null) unless it draws
 * on at least MIN_CELL people, and a figure shown beside another is withheld
 * when subtracting one from the other would reveal a smaller group.
 */
export const MIN_CELL = 5;

/** Observations whose signature stands: signed, possibly under review, never voided. */
export const STANDING_SIGNED = ['signed', 'under_review'] as const;

/** `n` when it counts at least MIN_CELL people, otherwise withheld. */
export const cell = (n: number) => (n >= MIN_CELL ? n : null);

/** How many distinct people `rows` are about. */
export const distinctPeople = (rows: ReadonlyArray<{ readonly subjectId: string }>) =>
  new Set(rows.map((r) => r.subjectId)).size;

/**
 * The coverage figures shown, from distinct-people counts. "Observed" is
 * withheld when it, or its complement (people with a plan who were not
 * observed, which a reader gets by subtraction), is under MIN_CELL, and
 * whenever "with a plan" itself is withheld.
 */
export const coverageFigures = (withPlan: number, observed: number) => {
  const shown = cell(withPlan);
  return {
    withPlan: shown,
    observed: shown !== null && cell(withPlan - observed) !== null ? cell(observed) : null,
  };
};

/**
 * Distinct people with an active or paused plan, and those of them observed
 * (a signature that stands) for work done in the last six weeks.
 */
export const coveragePeople = Effect.fn('program.coveragePeople')(function* (
  tenantId: TenantId,
  on: IsoDate,
) {
  const db = yield* Db;
  const owners = yield* db
    .selectDistinct({ ownerId: schema.plan.ownerId })
    .from(schema.plan)
    .where(
      and(eq(schema.plan.tenantId, tenantId), inArray(schema.plan.status, ['active', 'paused'])),
    );
  const observed = owners.length
    ? yield* db
        .selectDistinct({ subjectId: schema.observation.subjectId })
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
            gte(schema.interaction.occurredOn, addDaysIso(on, -42)),
            inArray(
              schema.observation.subjectId,
              owners.map((o) => o.ownerId),
            ),
          ),
        )
    : [];
  return {
    withPlan: owners.map((o) => o.ownerId),
    observed: observed.map((o) => o.subjectId),
  };
});

/** The two coverage figures, suppressed (home and the adoption view). */
export const planCoverage = Effect.fn('program.coverage')(function* (
  tenantId: TenantId,
  on: IsoDate,
) {
  const people = yield* coveragePeople(tenantId, on);
  return coverageFigures(people.withPlan.length, people.observed.length);
});
