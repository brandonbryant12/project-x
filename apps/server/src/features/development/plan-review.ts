import { CurrentActor, Unprocessable, type RecordPlanReviewInput } from '@repo/api';
import type { PlanId } from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { now, today } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { loadPlanSkills } from '../shared/catalog-reads.ts';
import { requireUpdated, requireVersion } from '../shared/mutation.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import { confirmReviewRefusal, planRelation, recordReviewRefusal } from './permissions.ts';
import { loadPlan, refuse } from './use-cases.ts';

/**
 * The closing review (design §8): what became of each focus skill, plus a
 * summary. A fact with its own audit events, not a lifecycle. The owner records
 * it, and may record it again, until an agreer confirms it; confirmation fixes
 * it. It is a person's judgement, never computed from badges, and it never
 * writes credit or a badge.
 */
export const recordPlanReview = Effect.fn('useCase.recordPlanReview')(function* (
  planId: PlanId,
  input: RecordPlanReviewInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const plan = yield* loadPlan(planId);
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const refusal = recordReviewRefusal(planRelation(actor, plan.ownerId, facts, yield* today), plan);
  if (refusal) return yield* refuse(refusal);
  yield* requireVersion('plan', input.version, plan.version);
  const focus = (yield* loadPlanSkills(actor.tenantId, [plan.id])).get(plan.id) ?? [];
  const outcomes = new Map(input.outcomes.map((o) => [o.skillId, o.outcome]));
  const exact =
    outcomes.size === input.outcomes.length &&
    outcomes.size === focus.length &&
    focus.every((f) => outcomes.has(f.skillId));
  if (!exact) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Give one outcome for each focus skill.', field: 'outcomes' }),
    );
  }
  const summary = input.summary.trim();
  if (summary.length === 0) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Write the closing summary.', field: 'summary' }),
    );
  }
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.plan)
        .set({
          closingSummary: summary,
          reviewRecordedById: actor.personId,
          reviewRecordedAt: at,
          version: plan.version + 1,
          updatedAt: at,
        })
        .where(and(eq(schema.plan.id, plan.id), eq(schema.plan.version, plan.version)))
        .returning({ id: schema.plan.id })
        .pipe(Effect.flatMap(requireUpdated('plan')));
      for (const [skillId, outcome] of outcomes) {
        yield* db
          .update(schema.planSkill)
          .set({ outcome })
          .where(
            and(
              eq(schema.planSkill.tenantId, actor.tenantId),
              eq(schema.planSkill.planId, plan.id),
              eq(schema.planSkill.skillId, skillId),
            ),
          );
      }
      yield* recordAudit(actor, {
        entityType: 'plan',
        entityId: plan.id,
        event: 'REVIEW_RECORDED',
        data: {
          // The summary is content and stays on the plan; the audit keeps the facts.
          outcomes: Object.fromEntries(outcomes),
          again: plan.reviewRecordedAt !== null,
        },
      });
    }),
  );
});

/**
 * An agreer confirms the review they read. `loadedVersion` is the plan as they
 * loaded it: a review recorded again since (which bumps the plan's version) is
 * a Conflict, so nobody fixes outcomes or a summary they never saw.
 */
export const confirmPlanReview = Effect.fn('useCase.confirmPlanReview')(function* (
  planId: PlanId,
  loadedVersion: number,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const plan = yield* loadPlan(planId);
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const refusal = confirmReviewRefusal(
    planRelation(actor, plan.ownerId, facts, yield* today),
    plan,
  );
  if (refusal) return yield* refuse(refusal);
  yield* requireVersion('plan', loadedVersion, plan.version);
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.plan)
        .set({
          reviewConfirmedById: actor.personId,
          reviewConfirmedAt: at,
          version: plan.version + 1,
          updatedAt: at,
        })
        .where(and(eq(schema.plan.id, plan.id), eq(schema.plan.version, plan.version)))
        .returning({ id: schema.plan.id })
        .pipe(Effect.flatMap(requireUpdated('plan')));
      yield* recordAudit(actor, {
        entityType: 'plan',
        entityId: plan.id,
        event: 'REVIEW_CONFIRMED',
        data: { recordedBy: plan.reviewRecordedById },
      });
    }),
  );
});
