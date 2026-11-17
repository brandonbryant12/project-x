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
  type SetActivityValueInput,
  type UpdateActivityInput,
  type UpdatePlanInput,
} from '@repo/api';
import {
  ActivityId,
  ActivityLifecycle,
  EvidenceId,
  EvidenceLifecycle,
  InteractionId,
  LOG_WINDOW_DAYS,
  OPEN_OBSERVATION_STATES,
  PlanId,
  PlanLifecycle,
  creditPolicyVersion,
  defaultSkillRole,
  eligibleObserversOf,
  leaderChainOf,
  type ActivityEventType,
  type ActivityStatus,
  type ActivityTemplateId,
  type EvidenceStatus,
  type PersonId,
  type PlanEventType,
  type PlanStatus,
  type SkillId,
  type SkillRole,
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
} from '../shared/advisory/evidence-screening.ts';
import { recordAudit } from '../shared/audit.ts';
import { notify } from '../shared/notify.ts';
import { digestOf } from '../shared/notes.ts';
import { decide, requireUpdated, requireVersion } from '../shared/mutation.ts';
import { loadActivitySkillRows, loadPlanSkills } from '../shared/catalog-reads.ts';
import { tenantCreditPolicy } from '../shared/recognition.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import { currentPlanOf, planAgreers } from '../shared/plans.ts';
import {
  addWorkRefusal,
  editPlanRefusal,
  editWorkRefusal,
  planRelation,
  setValueRefusal,
  type Refusal,
} from './permissions.ts';

/** A refusal from `permissions.ts` as the API error it is. */
export const refuse = (refusal: Refusal) =>
  Effect.fail(
    refusal.kind === 'forbidden'
      ? new Forbidden({ message: refusal.message })
      : new Unprocessable({ message: refusal.message }),
  );

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

export const loadPlan = Effect.fn('plan.load')(function* (planId: PlanId) {
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
    return yield* Effect.fail(new Conflict({ message: 'You already have a current plan.' }));
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
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const who = planRelation(actor, plan.ownerId, facts, yield* today);
  // A closed plan is never edited; its closing review has its own use case.
  const refusal = editPlanRefusal(who, plan);
  if (refusal) return yield* refuse(refusal);
  yield* requireVersion('plan', input.version, plan.version);
  const { version: _loaded, ...edit } = input;
  if (input.focusSkills && plan.status !== 'draft') {
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Focus skills can change while the plan is a draft. Revise it first.',
        field: 'focusSkills',
      }),
    );
  }
  if (input.periodEnd !== undefined && input.periodEnd <= plan.periodStart) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'The plan must end after it starts.', field: 'periodEnd' }),
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
        data: {
          fields: Object.keys(edit),
          ...(input.periodEnd !== undefined && {
            periodEnd: { before: plan.periodEnd, after: input.periodEnd },
          }),
          ...(input.focusSkills && {
            focusSkills: input.focusSkills.map((f) => `${f.skillId}@${f.targetLevel}`),
          }),
        },
      });
    }),
  );
});

/**
 * A plan lifecycle event. `loadedVersion` is the plan as the person saw it
 * (every API call sends it): agreeing, revising or completing a plan that has
 * changed since is a Conflict. Only the seed omits it.
 */
export const planEvent = Effect.fn('useCase.planEvent')(function* (
  planId: PlanId,
  event: PlanEventType,
  loadedVersion?: number,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const plan = yield* loadPlan(planId);
  if (loadedVersion !== undefined) yield* requireVersion('plan', loadedVersion, plan.version);
  const on = yield* today;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const isOwner = plan.ownerId === actor.personId;
  const agreers = planAgreers(facts, plan.ownerId, on);
  const inChain = leaderChainOf(facts, plan.ownerId, on).includes(actor.personId);
  const reviewConfirmed = plan.reviewConfirmedAt !== null;
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
      reviewConfirmed,
    },
    event: { type: event },
    permitted: permitted[event],
    forbiddenMessage:
      event === 'AGREE'
        ? 'Plans are agreed by the owner’s coach, or by their leader if they have no coach.'
        : 'You cannot change this plan.',
    ...(event === 'PROPOSE' && {
      explain: 'Add one to three focus skills and at least one piece of work before proposing.',
    }),
    ...(event === 'REVISE' &&
      reviewConfirmed && {
        explain: 'The closing review is confirmed, so this plan can no longer be revised.',
      }),
  });
  const at = yield* now;
  // A revision reopens what was agreed: the agreement, the endorsement and any
  // closing review not yet confirmed no longer describe the plan (design §8).
  const revise = event === 'REVISE';
  const cleared = revise
    ? [
        ...(plan.agreedById ? ['agreement'] : []),
        ...(plan.endorsedById ? ['endorsement'] : []),
        ...(plan.reviewRecordedAt ? ['review'] : []),
      ]
    : [];
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.plan)
        .set({
          status: to,
          version: plan.version + 1,
          updatedAt: at,
          ...(event === 'AGREE' && { agreedById: actor.personId, agreedAt: at }),
          ...(revise && {
            agreedById: null,
            agreedAt: null,
            endorsedById: null,
            endorsedAt: null,
            closingSummary: null,
            reviewRecordedById: null,
            reviewRecordedAt: null,
          }),
          ...(event === 'ENDORSE' && { endorsedById: actor.personId, endorsedAt: at }),
        })
        .where(and(eq(schema.plan.id, plan.id), eq(schema.plan.version, plan.version)))
        .returning({ id: schema.plan.id })
        .pipe(Effect.flatMap(requireUpdated('plan')));
      if (revise) {
        yield* db
          .update(schema.planSkill)
          .set({ outcome: null })
          .where(
            and(eq(schema.planSkill.tenantId, plan.tenantId), eq(schema.planSkill.planId, plan.id)),
          );
      }
      yield* recordAudit(actor, {
        entityType: 'plan',
        entityId: plan.id,
        event,
        from,
        to,
        ...(revise && { data: { cleared } }),
      });
      if (cleared.includes('review')) {
        yield* recordAudit(actor, {
          entityType: 'plan',
          entityId: plan.id,
          event: 'REVIEW_CLEARED',
          reasonCode: 'plan_review',
          data: { by: 'REVISE', recordedBy: plan.reviewRecordedById },
        });
      }
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

/**
 * The skills of a piece of work: each once, at most one primary, no more than
 * the hard ceiling (the schema bounds the count), and every newly chosen skill
 * published. A skill already on the work may stay after it is retired.
 */
const requireWorkSkills = Effect.fn('activity.requireSkills')(function* (
  tenantId: TenantId,
  skills: ReadonlyArray<{ readonly skillId: SkillId; readonly role: SkillRole }>,
  alreadyOn: ReadonlySet<SkillId> = new Set(),
) {
  if (skills.filter((s) => s.role === 'primary').length > 1) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Choose at most one primary skill.', field: 'skills' }),
    );
  }
  const ids = skills.map((s) => s.skillId);
  if (new Set(ids).size !== ids.length) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Each skill can be chosen once.', field: 'skills' }),
    );
  }
  yield* requirePublishedSkills(
    tenantId,
    ids.filter((id) => !alreadyOn.has(id)),
  );
});

/** The intended observer must be able to observe the owner today. */
const requireIntendedObserver = Effect.fn('activity.requireObserver')(function* (
  facts: Effect.Success<ReturnType<typeof loadRelationshipFacts>>,
  ownerId: PersonId,
  observerId: PersonId | null,
) {
  if (!observerId) return;
  const eligible = eligibleObserversOf(facts, ownerId, yield* today).some(
    (e) => e.personId === observerId,
  );
  if (!eligible) {
    return yield* Effect.fail(
      new Unprocessable({
        message: 'That person cannot observe this work.',
        field: 'intendedObserverId',
      }),
    );
  }
});

/**
 * A published template of the tenant, with its own skills' roles and values.
 * Adding work copies these; signing reads the copy, never the live template.
 */
const loadPublishedTemplate = Effect.fn('template.loadPublished')(function* (
  tenantId: TenantId,
  templateId: ActivityTemplateId,
) {
  const db = yield* Db;
  const [template] = yield* db
    .select({ id: schema.activityTemplate.id, status: schema.activityTemplate.status })
    .from(schema.activityTemplate)
    .where(
      and(
        eq(schema.activityTemplate.tenantId, tenantId),
        eq(schema.activityTemplate.id, templateId),
      ),
    );
  if (template?.status !== 'published') {
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Start from a published template, or from something of your own.',
        field: 'templateId',
      }),
    );
  }
  const skills = yield* db
    .select()
    .from(schema.activityTemplateSkill)
    .where(
      and(
        eq(schema.activityTemplateSkill.tenantId, tenantId),
        eq(schema.activityTemplateSkill.templateId, templateId),
      ),
    );
  return new Map(skills.map((s) => [s.skillId, { role: s.role as SkillRole, points: s.points }]));
});

export const addActivity = Effect.fn('useCase.addActivity')(function* (
  planId: PlanId,
  input: AddActivityInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const plan = yield* loadPlan(planId);
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const refusal = addWorkRefusal(planRelation(actor, plan.ownerId, facts, yield* today), plan);
  if (refusal) return yield* refuse(refusal);
  yield* requireWorkSkills(actor.tenantId, input.skills);
  yield* requireIntendedObserver(facts, plan.ownerId, input.intendedObserverId);
  const template = input.templateId
    ? yield* loadPublishedTemplate(actor.tenantId, input.templateId)
    : new Map<SkillId, { role: SkillRole; points: number | null }>();
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
        intendedMode: input.intendedObserverId ? input.intendedMode : null,
        status: 'planned',
      });
      yield* db.insert(schema.activitySkill).values(
        input.skills.map((s, position) => {
          // The template's value holds only for its own skill in its own role.
          const fromTemplate = template.get(s.skillId);
          return {
            tenantId: actor.tenantId,
            activityId: id,
            skillId: s.skillId,
            position,
            role: s.role,
            templatePoints: fromTemplate?.role === s.role ? fromTemplate.points : null,
          };
        }),
      );
      yield* recordAudit(actor, {
        entityType: 'activity',
        entityId: id,
        event: 'CREATE',
        to: 'planned',
        data: {
          planId,
          templateId: input.templateId,
          skills: input.skills.map((s) => `${s.skillId}:${s.role}`),
        },
      });
    }),
  );
});

const loadActivity = Effect.fn('activity.load')(function* (activityId: ActivityId) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.activity)
    .where(and(eq(schema.activity.tenantId, actor.tenantId), eq(schema.activity.id, activityId)));
  if (!row) return yield* Effect.fail(new NotFound({ entity: 'activity', id: activityId }));
  return row;
});

/** The activity, its plan and how the actor stands to it; work outside a plan is not editable here. */
const loadWork = Effect.fn('activity.loadWork')(function* (activityId: ActivityId) {
  const actor = yield* CurrentActor;
  const activity = yield* loadActivity(activityId);
  if (!activity.planId) {
    return yield* Effect.fail(new Unprocessable({ message: 'This work is not part of a plan.' }));
  }
  const plan = yield* loadPlan(activity.planId);
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const who = planRelation(actor, plan.ownerId, facts, yield* today);
  return { activity, plan, facts, who };
});

/** `skill:role` pairs, for audit data. */
const roles = (rows: ReadonlyArray<{ skillId: SkillId; role: string }>) =>
  rows.map((r) => `${r.skillId}:${r.role}`);

/** Activity ids among `ids` that have an observation that is open or signed. */
export const observedActivityIds = Effect.fn('activity.observed')(function* (
  tenantId: TenantId,
  ids: ReadonlyArray<ActivityId>,
) {
  if (ids.length === 0) return new Set<ActivityId>();
  const db = yield* Db;
  const rows = yield* db
    .selectDistinct({ activityId: schema.interaction.activityId })
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
        inArray(schema.interaction.activityId, [...ids]),
        inArray(schema.observation.status, [...OPEN_OBSERVATION_STATES, 'signed', 'under_review']),
      ),
    );
  return new Set(rows.map((r) => r.activityId));
});

/**
 * Change planned work: title, description, due date, commitment and skills
 * with roles (design §6, §8). Skills are diffed, never deleted and re-created,
 * so an individual value survives edits to other fields and to roles. Removing
 * a skill removes its value, and changing a role drops the template's value
 * (it was for the other role). Observations that already exist keep the roles
 * their observers hold.
 */
export const updateActivity = Effect.fn('useCase.updateActivity')(function* (
  activityId: ActivityId,
  input: UpdateActivityInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const { activity, plan, facts, who } = yield* loadWork(activityId);
  const refusal = editWorkRefusal(who, plan, activity);
  if (refusal) return yield* refuse(refusal);
  yield* requireVersion('work', input.version, activity.version);
  const before =
    (yield* loadActivitySkillRows(actor.tenantId, [activity.id])).get(activity.id) ?? [];
  yield* requireWorkSkills(actor.tenantId, input.skills, new Set(before.map((row) => row.skillId)));
  yield* requireIntendedObserver(facts, plan.ownerId, input.intendedObserverId);
  const wanted = new Map(input.skills.map((s, position) => [s.skillId, { ...s, position }]));
  const removed = before.filter((row) => !wanted.has(row.skillId));
  const intendedMode = input.intendedObserverId ? input.intendedMode : null;
  const changed = [
    ...(input.title !== activity.title ? ['title'] : []),
    ...(input.description !== activity.description ? ['description'] : []),
    ...(input.dueOn !== activity.dueOn ? ['dueOn'] : []),
    ...(input.intendedObserverId !== activity.intendedObserverId ? ['intendedObserverId'] : []),
    ...(intendedMode !== activity.intendedMode ? ['intendedMode'] : []),
  ];
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.activity)
        .set({
          title: input.title,
          description: input.description,
          dueOn: input.dueOn,
          intendedObserverId: input.intendedObserverId,
          intendedMode,
          version: activity.version + 1,
          updatedAt: at,
        })
        .where(
          and(eq(schema.activity.id, activity.id), eq(schema.activity.version, activity.version)),
        )
        .returning({ id: schema.activity.id })
        .pipe(Effect.flatMap(requireUpdated('work')));
      if (removed.length > 0) {
        yield* db.delete(schema.activitySkill).where(
          and(
            eq(schema.activitySkill.tenantId, actor.tenantId),
            eq(schema.activitySkill.activityId, activity.id),
            inArray(
              schema.activitySkill.skillId,
              removed.map((r) => r.skillId),
            ),
          ),
        );
      }
      for (const row of before) {
        const next = wanted.get(row.skillId);
        if (!next || (next.role === row.role && next.position === row.position)) continue;
        yield* db
          .update(schema.activitySkill)
          .set({
            role: next.role,
            position: next.position,
            ...(next.role !== row.role && { templatePoints: null }),
          })
          .where(
            and(
              eq(schema.activitySkill.tenantId, actor.tenantId),
              eq(schema.activitySkill.activityId, activity.id),
              eq(schema.activitySkill.skillId, row.skillId),
            ),
          );
      }
      const added = input.skills.filter((s) => !before.some((row) => row.skillId === s.skillId));
      if (added.length > 0) {
        yield* db.insert(schema.activitySkill).values(
          added.map((s) => ({
            tenantId: actor.tenantId,
            activityId: activity.id,
            skillId: s.skillId,
            position: wanted.get(s.skillId)?.position ?? 0,
            role: s.role,
          })),
        );
      }
      yield* recordAudit(actor, {
        entityType: 'activity',
        entityId: activity.id,
        event: 'EDIT',
        data: {
          // Text fields are content: the audit names them, never copies them.
          changed,
          before: {
            dueOn: activity.dueOn,
            intendedObserverId: activity.intendedObserverId,
            intendedMode: activity.intendedMode,
            skills: roles(before),
          },
          after: {
            dueOn: input.dueOn,
            intendedObserverId: input.intendedObserverId,
            intendedMode,
            skills: roles(input.skills),
          },
          removedValues: removed
            .filter((r) => r.pointsOverride !== null)
            .map((r) => ({ skillId: r.skillId, points: r.pointsOverride })),
        },
      });
    }),
  );
  return plan.id;
});

/**
 * Set or clear one skill's individual value on planned work (design §6). It is
 * written before the work is observed, and applies only to work done on or
 * after the business date it is set (signing compares the work's date with
 * `points_override_at`), so it never values work that had already happened.
 * The reason is kept as a note and the change is audited with before and after.
 */
export const setActivityValue = Effect.fn('useCase.setActivityValue')(function* (
  activityId: ActivityId,
  input: SetActivityValueInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const { activity, plan, who } = yield* loadWork(activityId);
  const policy = yield* tenantCreditPolicy(actor.tenantId);
  const observed = (yield* observedActivityIds(actor.tenantId, [activity.id])).has(activity.id);
  const refusal = setValueRefusal(who, policy.activityOverrides, plan, { ...activity, observed });
  if (refusal) return yield* refuse(refusal);
  yield* requireVersion('work', input.version, activity.version);
  const reason = input.reason.trim();
  if (reason.length < 10) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Say why, in at least 10 characters.', field: 'reason' }),
    );
  }
  const { minPoints, maxPoints } = policy.activityOverrides;
  if (input.points !== null && (input.points < minPoints || input.points > maxPoints)) {
    return yield* Effect.fail(
      new Unprocessable({
        message: `Use a whole number from ${minPoints} to ${maxPoints}.`,
        field: 'points',
      }),
    );
  }
  const rows = (yield* loadActivitySkillRows(actor.tenantId, [activity.id])).get(activity.id) ?? [];
  const row = rows.find((r) => r.skillId === input.skillId);
  if (!row) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'That skill is not part of this work.', field: 'skillId' }),
    );
  }
  if (input.points === null && row.pointsOverride === null) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'This skill has no value of its own to clear.' }),
    );
  }
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      // The version bump serializes this with edits of the same work.
      yield* db
        .update(schema.activity)
        .set({ version: activity.version + 1, updatedAt: at })
        .where(
          and(eq(schema.activity.id, activity.id), eq(schema.activity.version, activity.version)),
        )
        .returning({ id: schema.activity.id })
        .pipe(Effect.flatMap(requireUpdated('work')));
      yield* db
        .update(schema.activitySkill)
        .set({
          pointsOverride: input.points,
          pointsOverrideById: input.points === null ? null : actor.personId,
          pointsOverrideAt: input.points === null ? null : at,
        })
        .where(
          and(
            eq(schema.activitySkill.tenantId, actor.tenantId),
            eq(schema.activitySkill.activityId, activity.id),
            eq(schema.activitySkill.skillId, row.skillId),
          ),
        );
      yield* recordAudit(actor, {
        entityType: 'activity',
        entityId: activity.id,
        event: input.points === null ? 'CLEAR_VALUE' : 'SET_VALUE',
        reasonCode: 'value_override',
        note: { kind: 'value_override', body: reason },
        policyVersion: creditPolicyVersion(policy),
        data: {
          skillId: row.skillId,
          role: row.role,
          before: { points: row.pointsOverride, setById: row.pointsOverrideById },
          after: {
            points: input.points,
            setById: input.points === null ? null : actor.personId,
            appliesFrom: input.points === null ? null : yield* today,
          },
        },
      });
    }),
  );
  return { planId: plan.id, ownerId: plan.ownerId };
});

export const activityEvent = Effect.fn('useCase.activityEvent')(function* (
  activityId: ActivityId,
  event: ActivityEventType,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const row = yield* loadActivity(activityId);
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
        new Unprocessable({
          message: 'This planned work is closed. Log it as something not in your plan instead.',
        }),
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
  const at = yield* now;
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
              role: defaultSkillRole(position),
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
        createdAt: at,
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
        // The application clock, as revisions use: the screening sweep compares the two.
        createdAt: at,
        updatedAt: at,
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
    }),
  );
  if (screening.status === 'available' && decisions.availability.enabled)
    yield* afterCommit(screenEvidenceWithAssistant(actor, evidence.id));
});
