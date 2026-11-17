import {
  ACTIVITY_GRACE_DAYS,
  ActivityLifecycle,
  CURRENT_PLAN_STATES,
  EngagementLifecycle,
  ObservationLifecycle,
  PLAN_GRACE_DAYS,
  PlanLifecycle,
  type ActivityStatus,
  type EngagementStatus,
  type ObservationStatus,
  type PlanStatus,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { Effect, Layer, Schedule } from 'effect';
import { Settings } from '../platform/settings.ts';
import { addDaysIso, now, today } from '../platform/time.ts';
import { recordAudit } from '../features/shared/audit.ts';
import { runScreeningSweep } from './screening.ts';

/**
 * Expiry sweeps (ADR 0011). Every expiry goes through the lifecycle machine,
 * is idempotent (version-guarded update), and is audited as a system action.
 * A transaction-scoped advisory lock keeps replicas from sweeping concurrently.
 */
const SWEEP_LOCK = 4_242_001;

interface SweepRow {
  readonly id: string;
  readonly tenantId: typeof schema.tenant.$inferSelect.id;
  readonly status: string;
  readonly version: number;
}

const expire = Effect.fn('sweep.expire')(function* <S extends string, R extends SweepRow>(input: {
  readonly entityType: string;
  readonly rows: ReadonlyArray<R>;
  readonly next: (status: S) => S | null;
  readonly update: (row: R, to: S) => Effect.Effect<ReadonlyArray<unknown>, unknown, Db>;
}) {
  let expired = 0;
  for (const row of input.rows) {
    const to = input.next(row.status as S);
    if (to === null) continue;
    const updated = yield* input.update(row, to);
    if (updated.length === 0) continue;
    yield* recordAudit(
      { tenantId: row.tenantId, personId: null },
      {
        entityType: input.entityType,
        entityId: row.id,
        event: 'EXPIRE',
        from: row.status,
        to,
        reasonCode: 'expired',
      },
    );
    expired++;
  }
  return expired;
});

export const runSweeps = Effect.fn('sweep.run')(function* () {
  const db = yield* Db;
  return yield* transactionally(
    Effect.gen(function* () {
      const locked = yield* db.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${SWEEP_LOCK}) as locked`,
      );
      if (!JSON.stringify(locked).includes('true')) return 0;
      const at = yield* now;
      const on = yield* today;
      const observations = yield* db
        .select()
        .from(schema.observation)
        .where(
          and(
            inArray(schema.observation.status, ['requested', 'drafting', 'returned']),
            lt(schema.observation.dueAt, at),
          ),
        );
      const engagements = yield* db
        .select()
        .from(schema.engagement)
        .where(and(eq(schema.engagement.status, 'proposed'), lt(schema.engagement.expiresAt, at)));
      const activities = yield* db
        .select()
        .from(schema.activity)
        .where(
          and(
            eq(schema.activity.status, 'planned'),
            lt(schema.activity.dueOn, addDaysIso(on, -ACTIVITY_GRACE_DAYS)),
          ),
        );
      // Every unfinished plan past its period and grace expires, drafts included,
      // so a plan revised late never blocks the owner's next one. A recorded
      // closing review does not exempt a plan: the review is a fact beside the
      // plan, it can still be recorded and confirmed once the plan has expired,
      // and expiry never clears it (design §8).
      const plans = yield* db
        .select()
        .from(schema.plan)
        .where(
          and(
            inArray(schema.plan.status, [...CURRENT_PLAN_STATES]),
            lt(schema.plan.periodEnd, addDaysIso(on, -PLAN_GRACE_DAYS)),
          ),
        );
      const counts = yield* Effect.all([
        expire<ObservationStatus, typeof schema.observation.$inferSelect>({
          entityType: 'observation',
          rows: observations,
          next: (s) =>
            ObservationLifecycle.next(
              s,
              {
                ratingsComplete: false,
                narrativeLength: 0,
                privacyHold: false,
                acknowledged: false,
              },
              { type: 'EXPIRE' },
            ),
          update: (row, to) =>
            db
              .update(schema.observation)
              .set({ status: to, version: row.version + 1, updatedAt: at })
              .where(
                and(eq(schema.observation.id, row.id), eq(schema.observation.version, row.version)),
              )
              .returning({ id: schema.observation.id }),
        }),
        expire<EngagementStatus, typeof schema.engagement.$inferSelect>({
          entityType: 'engagement',
          rows: engagements,
          next: (s) => EngagementLifecycle.next(s, { coachGrantActive: true }, { type: 'EXPIRE' }),
          update: (row, to) =>
            db
              .update(schema.engagement)
              .set({ status: to, version: row.version + 1, updatedAt: at })
              .where(
                and(eq(schema.engagement.id, row.id), eq(schema.engagement.version, row.version)),
              )
              .returning({ id: schema.engagement.id }),
        }),
        expire<ActivityStatus, typeof schema.activity.$inferSelect>({
          entityType: 'activity',
          rows: activities,
          next: (s) => ActivityLifecycle.next(s, {}, { type: 'EXPIRE' }),
          update: (row, to) =>
            db
              .update(schema.activity)
              .set({ status: to, version: row.version + 1, updatedAt: at })
              .where(and(eq(schema.activity.id, row.id), eq(schema.activity.version, row.version)))
              .returning({ id: schema.activity.id }),
        }),
        expire<PlanStatus, typeof schema.plan.$inferSelect>({
          entityType: 'plan',
          rows: plans,
          next: (s) =>
            PlanLifecycle.next(
              s,
              { focusSkillCount: 1, activityCount: 1, endorsed: false, reviewConfirmed: false },
              { type: 'EXPIRE' },
            ),
          update: (row, to) =>
            db
              .update(schema.plan)
              .set({ status: to, version: row.version + 1, updatedAt: at })
              .where(and(eq(schema.plan.id, row.id), eq(schema.plan.version, row.version)))
              .returning({ id: schema.plan.id }),
        }),
      ]);
      const total = counts.reduce((n, c) => n + c, 0);
      if (total > 0) yield* Effect.logInfo('expiry sweep', { expired: total });
      return total;
    }),
  );
});

export const SchedulerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* Settings;
    if (!settings.schedulerEnabled) return;
    yield* runSweeps().pipe(
      Effect.catchCause((cause) => Effect.logError('sweep failed', cause)),
      Effect.repeat(Schedule.spaced('1 minute')),
      Effect.forkScoped,
    );
    yield* runScreeningSweep().pipe(
      Effect.catchCause((cause) => Effect.logError('screening sweep failed', cause)),
      Effect.repeat(Schedule.spaced('5 minutes')),
      Effect.forkScoped,
    );
  }),
);
