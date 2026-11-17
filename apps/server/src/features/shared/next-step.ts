import { CURRENT_PLAN_STATES, type PersonId, type TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { loadPlanSkills } from './catalog-reads.ts';
import { progressFor } from './recognition.ts';

/**
 * A person's next step toward a badge: the first focus skill of their current
 * plan with an unmet benchmark (or the first focus skill when every benchmark
 * is met). Null without a current plan. The same rule Home uses.
 */
export const nextStepOf = Effect.fn('progress.nextStep')(function* (
  tenantId: TenantId,
  personId: PersonId,
) {
  const db = yield* Db;
  const [plan] = yield* db
    .select({ id: schema.plan.id })
    .from(schema.plan)
    .where(
      and(
        eq(schema.plan.tenantId, tenantId),
        eq(schema.plan.ownerId, personId),
        inArray(schema.plan.status, [...CURRENT_PLAN_STATES]),
      ),
    );
  if (!plan) return null;
  const focus = (yield* loadPlanSkills(tenantId, [plan.id])).get(plan.id) ?? [];
  const progress = yield* progressFor(
    tenantId,
    personId,
    focus.map((f) => f.skillId),
  );
  const next = progress.find((p) => p.criteria.some((c) => !c.met)) ?? progress[0];
  return next ? { skill: next.skill, sentence: next.nextStep } : null;
});
