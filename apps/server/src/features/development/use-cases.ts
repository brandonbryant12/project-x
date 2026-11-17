import { Decisions } from '@repo/ai';
import {
  Conflict,
  CurrentActor,
  Forbidden,
  NotFound,
  Unprocessable,
  type AddActivityInput,
  type CreatePlanInput,
  type LogInteractionInput,
  type UpdatePlanInput,
} from '@repo/api';
import {
  ActivityId,
  ActivityLifecycle,
  EvidenceId,
  EvidenceLifecycle,
  InteractionId,
  LOG_WINDOW_DAYS,
  PlanId,
  PlanLifecycle,
  eligibleObserversOf,
  leaderChainOf,
  type ActivityEventType,
  type ActivityStatus,
  type EvidenceStatus,
  type PlanEventType,
  type PlanStatus,
  type SkillId,
  type TenantId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { afterCommit } from '../../platform/background-context.ts';
import { addDaysIso, now, today } from '../../platform/time.ts';
import {
  initialEvidenceState,
  screenEvidenceWithAssistant,
  suggestSkills,
} from '../shared/advisory/evidence-screening.ts';
import { labelFromPrivacyDecision } from '../shared/advisory/labels.ts';
import { recordAudit } from '../shared/audit.ts';
import { notify } from '../shared/notify.ts';
import { digestOf } from '../shared/notes.ts';
import { decide, requireUpdated } from '../shared/mutation.ts';
import { loadPlanSkills } from '../shared/catalog-reads.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import { currentPlanOf, planAgreers } from '../shared/plans.ts';

const requirePublishedSkills = Effect.fn('skills.requirePublished')(function* (
  tenantId: TenantId,
  ids: ReadonlyArray<SkillId>,
) {
  if (new Set(ids).size !== ids.length) {
    return yield* Effect.fail(new Unprocessable({ message: 'Each skill can be chosen once.' }));
  }
  if (ids.length === 0) return;
  const db = yield* Db;
  const rows = yield* db
    .select({ id: schema.skill.id })
    .from(schema.skill)
    .where(
      and(
        eq(schema.skill.tenantId, tenantId),
        inArray(schema.skill.id, [...ids]),
        eq(schema.skill.status, 'published'),
      ),
    );
  if (rows.length !== ids.length) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Choose skills from the published catalog.', field: 'skills' }),
    );
  }
});

const loadPlan = Effect.fn('plan.load')(function* (planId: PlanId) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [plan] = yield* db
    .select()
    .from(schema.plan)
    .where(and(eq(schema.plan.tenantId, actor.tenantId), eq(schema.plan.id, planId)));
  if (!plan) return yield* Effect.fail(new NotFound({ entity: 'plan', id: planId }));
  return plan;
});

export const createPlan = Effect.fn('useCase.createPlan')(function* (input: CreatePlanInput) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  if (input.periodEnd <= input.periodStart) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'The plan must end after it starts.', field: 'periodEnd' }),
    );
  }
  yield* requirePublishedSkills(
    actor.tenantId,
    input.focusSkills.map((f) => f.skillId),
  );
  if (yield* currentPlanOf(actor.tenantId, actor.personId)) {
    return yield* Effect.fail(
      new Conflict({ message: 'You already have a current development plan.' }),
    );
  }
  const id = PlanId.generate();
  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.plan).values({
        id,
        tenantId: actor.tenantId,
        ownerId: actor.personId,
        title: input.title,
        intent: input.intent,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: 'draft',
      });
      yield* db.insert(schema.planSkill).values(
        input.focusSkills.map((f, position) => ({
          tenantId: actor.tenantId,
          planId: id,
          skillId: f.skillId,
          targetLevel: f.targetLevel,
          position,
        })),
      );
      yield* recordAudit(actor, { entityType: 'plan', entityId: id, event: 'CREATE', to: 'draft' });
    }),
  );
  return id;
});

export const updatePlan = Effect.fn('useCase.updatePlan')(function* (
  planId: PlanId,
  input: UpdatePlanInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const plan = yield* loadPlan(planId);
  if (plan.ownerId !== actor.personId) {
    return yield* Effect.fail(new Forbidden({ message: 'Only the plan’s owner can edit it.' }));
  }
  if (PlanLifecycle.isTerminal(plan.status as PlanStatus) && input.closingSummary === undefined) {
    return yield* Effect.fail(new Unprocessable({ message: 'This plan is closed.' }));
  }
  if (input.focusSkills && plan.status !== 'draft') {
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Focus skills can change while the plan is a draft. Revise it first.',
        field: 'focusSkills',
      }),
    );
  }
  if (input.focusSkills)
    yield* requirePublishedSkills(
      actor.tenantId,
      input.focusSkills.map((f) => f.skillId),
    );
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.plan)
        .set({
          ...(input.title !== undefined && { title: input.title }),
          ...(input.intent !== undefined && { intent: input.intent }),
          ...(input.periodEnd !== undefined && { periodEnd: input.periodEnd }),
          ...(input.closingSummary !== undefined && { closingSummary: input.closingSummary }),
          version: plan.version + 1,
          updatedAt: yield* now,
        })
        .where(and(eq(schema.plan.id, plan.id), eq(schema.plan.version, plan.version)))
        .returning({ id: schema.plan.id })
        .pipe(Effect.flatMap(requireUpdated('plan')));
      if (input.focusSkills) {
        yield* db.delete(schema.planSkill).where(eq(schema.planSkill.planId, plan.id));
        yield* db.insert(schema.planSkill).values(
          input.focusSkills.map((f, position) => ({
            tenantId: actor.tenantId,
            planId: plan.id,
            skillId: f.skillId,
            targetLevel: f.targetLevel,
            position,
          })),
        );
      }
      yield* recordAudit(actor, {
        entityType: 'plan',
        entityId: plan.id,
        event: 'EDIT',
        data: { fields: Object.keys(input) },
      });
    }),
  );
});

export const planEvent = Effect.fn('useCase.planEvent')(function* (
  planId: PlanId,
  event: PlanEventType,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const plan = yield* loadPlan(planId);
  const on = yield* today;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const isOwner = plan.ownerId === actor.personId;
  const agreers = planAgreers(facts, plan.ownerId, on);
  const inChain = leaderChainOf(facts, plan.ownerId, on).includes(actor.personId);
  const permitted: Record<PlanEventType, boolean> = {
    PROPOSE: isOwner,
    REVISE: isOwner || agreers.includes(actor.personId),
    AGREE: !isOwner && agreers.includes(actor.personId),
    ENDORSE: !isOwner && inChain,
    PAUSE: isOwner,
    RESUME: isOwner,
    COMPLETE: isOwner,
    CANCEL: isOwner,
    EXPIRE: false,
  };
  const focusCount = ((yield* loadPlanSkills(actor.tenantId, [plan.id])).get(plan.id) ?? []).length;
  const [activityCount] = yield* db
    .select({ n: count() })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.planId, plan.id),
        inArray(schema.activity.status, ['planned', 'underway', 'done']),
      ),
    );
  const from = plan.status as PlanStatus;
  const to = yield* decide({
    lifecycle: PlanLifecycle,
    from,
    facts: {
      focusSkillCount: focusCount,
      activityCount: activityCount?.n ?? 0,
      endorsed: plan.endorsedById !== null,
    },
    event: { type: event },
    permitted: permitted[event],
    forbiddenMessage:
      event === 'AGREE'
        ? 'Plans are agreed by the owner’s coach, or by their leader if they have no coach.'
        : 'You cannot change this plan.',
    ...(event === 'PROPOSE' && {
      explain: 'Add one to three focus skills and at least one activity before proposing.',
    }),
  });
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.plan)
        .set({
          status: to,
          version: plan.version + 1,
          updatedAt: at,
          ...(event === 'AGREE' && { agreedById: actor.personId, agreedAt: at }),
          ...(event === 'REVISE' && { agreedById: null, agreedAt: null }),
          ...(event === 'ENDORSE' && { endorsedById: actor.personId, endorsedAt: at }),
        })
        .where(and(eq(schema.plan.id, plan.id), eq(schema.plan.version, plan.version)))
        .returning({ id: schema.plan.id })
        .pipe(Effect.flatMap(requireUpdated('plan')));
      yield* recordAudit(actor, { entityType: 'plan', entityId: plan.id, event, from, to });
      if (event === 'PROPOSE') {
        for (const recipientId of agreers) {
          yield* notify(actor.tenantId, {
            recipientId,
            kind: 'plan_proposed',
            entityType: 'plan',
            entityId: plan.id,
            actorId: actor.personId,
            occurrence: `v${plan.version + 1}`,
          });
        }
      }
    }),
  );
});

export const addActivity = Effect.fn('useCase.addActivity')(function* (
  planId: PlanId,
  input: AddActivityInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const plan = yield* loadPlan(planId);
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const canEdit =
    plan.ownerId === actor.personId ||
    planAgreers(facts, plan.ownerId, on).includes(actor.personId);
  if (!canEdit)
    return yield* Effect.fail(
      new Forbidden({ message: 'Only the owner or their coach can add activities.' }),
    );
  if (PlanLifecycle.isTerminal(plan.status as PlanStatus)) {
    return yield* Effect.fail(new Unprocessable({ message: 'This plan is closed.' }));
  }
  yield* requirePublishedSkills(actor.tenantId, input.targetSkillIds);
  if (input.intendedObserverId) {
    const eligible = eligibleObserversOf(facts, plan.ownerId, on).some(
      (e) => e.personId === input.intendedObserverId,
    );
    if (!eligible) {
      return yield* Effect.fail(
        new Unprocessable({
          message: 'That person cannot observe this work.',
          field: 'intendedObserverId',
        }),
      );
    }
  }
  const id = ActivityId.generate();
  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.activity).values({
        id,
        tenantId: actor.tenantId,
        planId: plan.id,
        ownerId: plan.ownerId,
        templateId: input.templateId,
        title: input.title,
        description: input.description,
        dueOn: input.dueOn,
        origin: 'planned',
        intendedObserverId: input.intendedObserverId,
        intendedMode: input.intendedMode,
        status: 'planned',
      });
      yield* db.insert(schema.activitySkill).values(
        input.targetSkillIds.map((skillId, position) => ({
          tenantId: actor.tenantId,
          activityId: id,
          skillId,
          position,
        })),
      );
      yield* recordAudit(actor, {
        entityType: 'activity',
        entityId: id,
        event: 'CREATE',
        to: 'planned',
        data: { planId },
      });
    }),
  );
});

export const activityEvent = Effect.fn('useCase.activityEvent')(function* (
  activityId: ActivityId,
  event: ActivityEventType,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.activity)
    .where(and(eq(schema.activity.tenantId, actor.tenantId), eq(schema.activity.id, activityId)));
  if (!row) return yield* Effect.fail(new NotFound({ entity: 'activity', id: activityId }));
  const from = row.status as ActivityStatus;
  const to = yield* decide({
    lifecycle: ActivityLifecycle,
    from,
    facts: {},
    event: { type: event },
    permitted: row.ownerId === actor.personId && (event === 'COMPLETE' || event === 'CANCEL'),
  });
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.activity)
        .set({ status: to, version: row.version + 1, updatedAt: yield* now })
        .where(and(eq(schema.activity.id, row.id), eq(schema.activity.version, row.version)))
        .returning({ id: schema.activity.id })
        .pipe(Effect.flatMap(requireUpdated('activity')));
      yield* recordAudit(actor, { entityType: 'activity', entityId: row.id, event, from, to });
    }),
  );
  return row.planId;
});

/**
 * Log one occurrence of real work with the owner's reflection. Never credits
 * anything (I2). The reflection is screened: locally (fails closed) and, when
 * assistant checks are on, by the AI privacy screen after commit.
 */
export const logInteraction = Effect.fn('useCase.logInteraction')(function* (
  input: LogInteractionInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const decisions = yield* Decisions;
  const on = yield* today;
  if (input.occurredOn > on) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Log work that has already happened.', field: 'occurredOn' }),
    );
  }
  if (input.occurredOn < addDaysIso(on, -LOG_WINDOW_DAYS)) {
    return yield* Effect.fail(
      new Unprocessable({
        message: `Log work within ${LOG_WINDOW_DAYS} days of doing it.`,
        field: 'occurredOn',
      }),
    );
  }
  let activityId = input.activityId;
  if (activityId) {
    const [activity] = yield* db
      .select()
      .from(schema.activity)
      .where(and(eq(schema.activity.tenantId, actor.tenantId), eq(schema.activity.id, activityId)));
    if (!activity || activity.ownerId !== actor.personId) {
      return yield* Effect.fail(new NotFound({ entity: 'activity', id: activityId }));
    }
    if (
      ActivityLifecycle.next(activity.status as ActivityStatus, {}, { type: 'LOG_INTERACTION' }) ===
      null
    ) {
      return yield* Effect.fail(
        new Unprocessable({ message: 'This activity is closed. Log it as other work instead.' }),
      );
    }
  } else if (!input.adHocTitle || input.adHocTitle.trim().length < 3) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Name the work you did.', field: 'adHocTitle' }),
    );
  }
  yield* requirePublishedSkills(actor.tenantId, input.adHocSkillIds);

  const interactionId = InteractionId.generate();
  const evidenceId = EvidenceId.generate();
  const screening = initialEvidenceState(input.reflection);
  yield* transactionally(
    Effect.gen(function* () {
      if (!activityId) {
        activityId = ActivityId.generate();
        const plan = yield* currentPlanOf(actor.tenantId, actor.personId);
        yield* db.insert(schema.activity).values({
          id: activityId,
          tenantId: actor.tenantId,
          planId: plan?.id ?? null,
          ownerId: actor.personId,
          title: (input.adHocTitle ?? '').trim(),
          origin: 'ad_hoc',
          status: 'planned',
        });
        if (input.adHocSkillIds.length > 0) {
          yield* db.insert(schema.activitySkill).values(
            input.adHocSkillIds.map((skillId, position) => ({
              tenantId: actor.tenantId,
              activityId: activityId as ActivityId,
              skillId,
              position,
            })),
          );
        }
      }
      const [activity] = yield* db
        .select()
        .from(schema.activity)
        .where(eq(schema.activity.id, activityId));
      if (!activity) return yield* Effect.die('invariant: activity vanished');
      const nextStatus = ActivityLifecycle.next(
        activity.status as ActivityStatus,
        {},
        { type: 'LOG_INTERACTION' },
      );
      if (nextStatus && nextStatus !== activity.status) {
        yield* db
          .update(schema.activity)
          .set({ status: nextStatus, version: activity.version + 1, updatedAt: yield* now })
          .where(eq(schema.activity.id, activity.id));
        yield* recordAudit(actor, {
          entityType: 'activity',
          entityId: activity.id,
          event: 'LOG_INTERACTION',
          from: activity.status,
          to: nextStatus,
        });
      }
      yield* db.insert(schema.interaction).values({
        id: interactionId,
        tenantId: actor.tenantId,
        activityId: activity.id,
        ownerId: actor.personId,
        loggedById: actor.personId,
        occurredOn: input.occurredOn,
        kind: input.kind,
        clientRef: input.clientRef,
        // The Effect clock, not the database's: replayed history and tests stay honest.
        createdAt: yield* now,
      });
      yield* db.insert(schema.evidence).values({
        id: evidenceId,
        tenantId: actor.tenantId,
        interactionId,
        authorId: actor.personId,
        body: input.reflection,
        contentDigest: digestOf(input.reflection),
        status: screening.status,
        holdReason: screening.holdReason,
      });
      yield* recordAudit(actor, {
        entityType: 'interaction',
        entityId: interactionId,
        event: 'LOG',
        data: { kind: input.kind },
      });
      yield* recordAudit(actor, {
        entityType: 'evidence',
        entityId: evidenceId,
        event: screening.status === 'held' ? 'HOLD' : 'SUBMIT',
        to: screening.status,
        ...(screening.status === 'held' && { reasonCode: 'privacy_local' as const }),
        policyVersion: 'local-screen@1',
      });
    }),
  );
  if (screening.status === 'available' && decisions.availability.enabled)
    yield* afterCommit(screenEvidenceWithAssistant(actor, evidenceId));
  if (screening.status !== 'held')
    yield* afterCommit(suggestSkills(actor, interactionId, input.reflection));
  return interactionId;
});

/** The author rewrites held or available evidence; it goes back through screening. */
export const reviseEvidence = Effect.fn('useCase.reviseEvidence')(function* (
  interactionId: InteractionId,
  body: string,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const decisions = yield* Decisions;
  const [evidence] = yield* db
    .select()
    .from(schema.evidence)
    .where(
      and(
        eq(schema.evidence.tenantId, actor.tenantId),
        eq(schema.evidence.interactionId, interactionId),
      ),
    );
  if (!evidence)
    return yield* Effect.fail(new NotFound({ entity: 'interaction', id: interactionId }));
  const from = evidence.status as EvidenceStatus;
  yield* decide({
    lifecycle: EvidenceLifecycle,
    from,
    facts: {},
    event: { type: 'REVISE' },
    permitted: evidence.authorId === actor.personId,
    forbiddenMessage: 'Only the author can revise this.',
  });
  const screening = initialEvidenceState(body);
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.evidence)
        .set({
          body,
          contentDigest: digestOf(body),
          status: screening.status,
          holdReason: screening.holdReason,
          version: evidence.version + 1,
          updatedAt: yield* now,
        })
        .where(
          and(eq(schema.evidence.id, evidence.id), eq(schema.evidence.version, evidence.version)),
        )
        .returning({ id: schema.evidence.id })
        .pipe(Effect.flatMap(requireUpdated('reflection')));
      yield* recordAudit(actor, {
        entityType: 'evidence',
        entityId: evidence.id,
        event: 'REVISE',
        from,
        to: screening.status,
        ...(screening.status === 'held' && { reasonCode: 'privacy_local' as const }),
        policyVersion: 'local-screen@1',
      });
      // Revising text the assistant held is weak evidence the hold was right (ADR 0016).
      if (from === 'held') yield* labelFromPrivacyDecision(actor, evidence.id, 'revised');
    }),
  );
  if (screening.status === 'available' && decisions.availability.enabled)
    yield* afterCommit(screenEvidenceWithAssistant(actor, evidence.id));
});
