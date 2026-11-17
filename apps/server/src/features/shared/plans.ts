import {
  CURRENT_PLAN_STATES,
  coachesOf,
  leaderOf,
  type IsoDate,
  type PersonId,
  type RelationshipFacts,
  type SkillId,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

/** Who may agree a plan: the owner's coach, or their leader if they have no coach. */
export const planAgreers = (facts: RelationshipFacts, ownerId: PersonId, on: IsoDate) => {
  const coaches = coachesOf(facts, ownerId, on);
  if (coaches.length > 0) return coaches;
  const leader = leaderOf(facts, ownerId, on);
  return leader ? [leader] : [];
};

/** The person's current plan (draft, proposed, active or paused), if any. */
export const currentPlanOf = Effect.fn('development.currentPlan')(function* (
  tenantId: TenantId,
  personId: PersonId,
) {
  const db = yield* Db;
  const [plan] = yield* db
    .select()
    .from(schema.plan)
    .where(
      and(
        eq(schema.plan.tenantId, tenantId),
        eq(schema.plan.ownerId, personId),
        inArray(schema.plan.status, [...CURRENT_PLAN_STATES]),
      ),
    );
  return plan;
});

/** Skill ids in the person's current plan (focus skills and activity targets). */
export const currentPlanSkillIds = Effect.fn('plan.currentSkills')(function* (
  tenantId: TenantId,
  personId: PersonId,
) {
  const db = yield* Db;
  const rows = yield* db
    .select({ skillId: schema.planSkill.skillId })
    .from(schema.planSkill)
    .innerJoin(schema.plan, eq(schema.plan.id, schema.planSkill.planId))
    .where(
      and(
        eq(schema.plan.tenantId, tenantId),
        eq(schema.plan.ownerId, personId),
        inArray(schema.plan.status, [...CURRENT_PLAN_STATES]),
      ),
    );
  return new Set<SkillId>(rows.map((r) => r.skillId));
});
