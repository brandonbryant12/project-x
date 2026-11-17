import type {
  Actor,
  ActivityView,
  DevelopmentView,
  InteractionSummary,
  InteractionView,
  PlanView,
  PersonSummary,
} from '@repo/api';
import {
  ActivityLifecycle,
  CURRENT_PLAN_STATES,
  LEVEL_NAMES,
  OPEN_OBSERVATION_STATES,
  PlanLifecycle,
  canReadNarrative,
  coachesOf,
  developmentAccess,
  eligibleObserversOf,
  leaderChainOf,
  leaderOf,
  type ActivityStatus,
  type EvidenceStatus,
  type InteractionId,
  type InteractionKind,
  type IsoDate,
  type ObservationMode,
  type ObservationStatus,
  type PersonId,
  type PlanEventType,
  type PlanId,
  type PlanStatus,
  type RelationshipFacts,
  type SkillId,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, inArray, isNotNull, ne, notInArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { today } from '../../platform/time.ts';
import { loadPeople, personFrom } from '../shared/people.ts';
import { netCreditsBySkill, progressFor } from '../shared/recognition.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import { loadActivitySkills, loadPlanSkills } from '../shared/catalog-reads.ts';
import { currentPlanOf, planAgreers } from '../shared/plans.ts';
import { loadSkills, refsFor, toSkillRef } from '../shared/skills.ts';

type PlanRow = typeof schema.plan.$inferSelect;

/** Plan events the viewer may send, from lifecycle (can) ∩ policy (who). */
const planActions = (
  plan: PlanRow,
  focusSkillCount: number,
  activityCount: number,
  viewerId: PersonId,
  facts: RelationshipFacts,
  on: IsoDate,
): ReadonlyArray<PlanEventType> => {
  const isOwner = plan.ownerId === viewerId;
  const canAgree = planAgreers(facts, plan.ownerId, on).includes(viewerId);
  const inChain = leaderChainOf(facts, plan.ownerId, on).includes(viewerId);
  const facts$ = {
    focusSkillCount,
    activityCount,
    endorsed: plan.endorsedById !== null,
  };
  const allowedByPolicy: Record<PlanEventType, boolean> = {
    PROPOSE: isOwner,
    REVISE: isOwner || canAgree,
    AGREE: canAgree && !isOwner,
    ENDORSE: inChain && !isOwner,
    PAUSE: isOwner,
    RESUME: isOwner,
    COMPLETE: isOwner,
    CANCEL: isOwner,
    EXPIRE: false,
  };
  return PlanLifecycle.allowed(
    plan.status as PlanStatus,
    facts$,
    PlanLifecycle.events.filter((e) => allowedByPolicy[e]).map((type) => ({ type })),
  );
};

const interactionSummaries = Effect.fn('development.interactions')(function* (
  tenantId: TenantId,
  interactionRows: ReadonlyArray<typeof schema.interaction.$inferSelect>,
  viewerId: PersonId,
  facts: RelationshipFacts,
) {
  const db = yield* Db;
  const ids = interactionRows.map((i) => i.id);
  if (ids.length === 0) return new Map<InteractionId, InteractionSummary>();
  const [evidence, observations] = yield* Effect.all([
    db
      .select()
      .from(schema.evidence)
      .where(
        and(eq(schema.evidence.tenantId, tenantId), inArray(schema.evidence.interactionId, ids)),
      ),
    db
      .select()
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.tenantId, tenantId),
          inArray(schema.observation.interactionId, ids),
        ),
      ),
  ]);
  const people = yield* loadPeople(
    tenantId,
    observations.map((o) => o.observerId),
  );
  const result = new Map<InteractionId, InteractionSummary>();
  for (const interaction of interactionRows) {
    const ev = evidence.filter((e) => e.interactionId === interaction.id).at(-1);
    const obs = observations.filter((o) => o.interactionId === interaction.id);
    const live = new Set(
      obs
        .filter((o) => [...OPEN_OBSERVATION_STATES, 'signed'].includes(o.status as never))
        .map((o) => o.observerId),
    );
    const eligible = eligibleObserversOf(facts, interaction.ownerId, interaction.occurredOn);
    result.set(interaction.id, {
      id: interaction.id,
      occurredOn: interaction.occurredOn,
      kind: interaction.kind as InteractionKind,
      evidenceStatus: (ev?.status as EvidenceStatus | undefined) ?? null,
      observations: obs.map((o) => ({
        id: o.id,
        status: o.status as ObservationStatus,
        observer: personFrom(people, o.observerId),
      })),
      canRequestObservation:
        interaction.ownerId === viewerId &&
        ev?.status !== 'held' &&
        eligible.some((e) => !live.has(e.personId)),
    });
  }
  return result;
});

/** "Try next time": the latest signed "What next", for those who may read narratives (I13). */
const latestTryNext = Effect.fn('development.tryNext')(function* (
  actor: Actor,
  facts: RelationshipFacts,
  ownerId: PersonId,
  on: IsoDate,
) {
  const db = yield* Db;
  const [row] = yield* db
    .select({
      id: schema.observation.id,
      observerId: schema.observation.observerId,
      narrativeNext: schema.observation.narrativeNext,
      signedAt: schema.observation.signedAt,
    })
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.tenantId, actor.tenantId),
        eq(schema.observation.subjectId, ownerId),
        inArray(schema.observation.status, ['signed', 'under_review']),
        isNotNull(schema.observation.narrativeNext),
        ne(schema.observation.narrativeNext, ''),
      ),
    )
    .orderBy(desc(schema.observation.signedAt))
    .limit(1);
  if (!row?.narrativeNext || !row.signedAt) return null;
  const readable = canReadNarrative(facts, {
    viewerId: actor.personId,
    subjectId: ownerId,
    observerId: row.observerId,
    on,
  });
  return readable ? { ...row, narrativeNext: row.narrativeNext, signedAt: row.signedAt } : null;
});

export const buildPlanView = Effect.fn('development.planView')(function* (
  actor: Actor,
  planId: PlanId,
) {
  const db = yield* Db;
  const [plan] = yield* db
    .select()
    .from(schema.plan)
    .where(and(eq(schema.plan.tenantId, actor.tenantId), eq(schema.plan.id, planId)));
  if (!plan) return yield* Effect.die(`invariant: plan ${planId} missing`);
  const on = yield* today;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const activities = yield* db
    .select()
    .from(schema.activity)
    .where(and(eq(schema.activity.tenantId, actor.tenantId), eq(schema.activity.planId, plan.id)))
    .orderBy(schema.activity.createdAt);
  const interactions = activities.length
    ? yield* db
        .select()
        .from(schema.interaction)
        .where(
          and(
            eq(schema.interaction.tenantId, actor.tenantId),
            inArray(
              schema.interaction.activityId,
              activities.map((a) => a.id),
            ),
          ),
        )
        .orderBy(desc(schema.interaction.occurredOn))
    : [];
  const summaries = yield* interactionSummaries(
    actor.tenantId,
    interactions,
    actor.personId,
    facts,
  );
  const focus = (yield* loadPlanSkills(actor.tenantId, [plan.id])).get(plan.id) ?? [];
  const activitySkills = yield* loadActivitySkills(
    actor.tenantId,
    activities.map((a) => a.id),
  );
  const coachId = coachesOf(facts, plan.ownerId, on)[0];
  const leaderId = leaderOf(facts, plan.ownerId, on);
  const tryNext = yield* latestTryNext(actor, facts, plan.ownerId, on);
  const people = yield* loadPeople(actor.tenantId, [
    plan.ownerId,
    ...(tryNext ? [tryNext.observerId] : []),
    ...(coachId ? [coachId] : []),
    ...(leaderId ? [leaderId] : []),
    ...(plan.agreedById ? [plan.agreedById] : []),
    ...(plan.endorsedById ? [plan.endorsedById] : []),
    ...activities.flatMap((a) => (a.intendedObserverId ? [a.intendedObserverId] : [])),
  ]);
  const skills = yield* loadSkills(actor.tenantId, [
    ...focus.map((f) => f.skillId),
    ...[...activitySkills.values()].flat(),
  ]);
  const templates = yield* loadTemplates(
    actor.tenantId,
    activities.flatMap((a) => (a.templateId ? [a.templateId] : [])),
  );
  const isOwner = plan.ownerId === actor.personId;

  const activityViews = activities.map((a): ActivityView => ({
    id: a.id,
    title: a.title,
    description: a.description,
    status: a.status as ActivityStatus,
    origin: a.origin as ActivityView['origin'],
    dueOn: a.dueOn,
    template: a.templateId
      ? { id: a.templateId, name: templates.get(a.templateId) ?? 'Template' }
      : null,
    targetSkills: refsFor(skills, activitySkills.get(a.id) ?? []),
    intendedObserver: a.intendedObserverId ? (people.get(a.intendedObserverId) ?? null) : null,
    intendedMode: (a.intendedMode as ObservationMode | null) ?? null,
    interactions: interactions.flatMap((i) => {
      const summary = i.activityId === a.id ? summaries.get(i.id) : undefined;
      return summary ? [summary] : [];
    }),
    actions: isOwner
      ? ActivityLifecycle.allowed(a.status as ActivityStatus, {}, [
          { type: 'COMPLETE' },
          { type: 'CANCEL' },
        ])
      : [],
  }));
  const optional = (id: PersonId | null | undefined): PersonSummary | null =>
    id ? (people.get(id) ?? null) : null;

  return {
    id: plan.id,
    title: plan.title,
    intent: plan.intent,
    status: plan.status as PlanStatus,
    periodStart: plan.periodStart,
    periodEnd: plan.periodEnd,
    owner: personFrom(people, plan.ownerId),
    coach: optional(coachId),
    leader: optional(leaderId),
    focusSkills: focus.flatMap((f) => {
      const row = skills.get(f.skillId);
      return row
        ? [
            {
              skill: toSkillRef(row),
              targetLevel: f.targetLevel,
              targetLevelName: LEVEL_NAMES[f.targetLevel],
              outcome: f.outcome,
            },
          ]
        : [];
    }),
    agreedBy: optional(plan.agreedById),
    agreedAt: plan.agreedAt?.toISOString() ?? null,
    endorsedBy: optional(plan.endorsedById),
    closingSummary: plan.closingSummary,
    tryNextTime: tryNext
      ? {
          sentence: tryNext.narrativeNext,
          observer: personFrom(people, tryNext.observerId),
          signedAt: tryNext.signedAt.toISOString(),
          observationId: tryNext.id,
        }
      : null,
    activities: activityViews,
    progress: yield* progressFor(
      actor.tenantId,
      plan.ownerId,
      focus.map((f) => f.skillId),
    ),
    actions: planActions(plan, focus.length, activities.length, actor.personId, facts, on),
  } satisfies PlanView;
});

const loadTemplates = Effect.fn('development.templates')(function* (
  tenantId: TenantId,
  ids: ReadonlyArray<typeof schema.activityTemplate.$inferSelect.id>,
) {
  if (ids.length === 0) return new Map<string, string>();
  const db = yield* Db;
  const rows = yield* db
    .select({ id: schema.activityTemplate.id, name: schema.activityTemplate.name })
    .from(schema.activityTemplate)
    .where(
      and(
        eq(schema.activityTemplate.tenantId, tenantId),
        inArray(schema.activityTemplate.id, [...ids]),
      ),
    );
  return new Map<string, string>(rows.map((r) => [r.id, r.name]));
});

export const buildDevelopmentView = Effect.fn('development.view')(function* (
  actor: Actor,
  personId: PersonId,
) {
  const db = yield* Db;
  const current = yield* currentPlanOf(actor.tenantId, personId);
  const past = yield* db
    .select()
    .from(schema.plan)
    .where(
      and(
        eq(schema.plan.tenantId, actor.tenantId),
        eq(schema.plan.ownerId, personId),
        notInArray(schema.plan.status, [...CURRENT_PLAN_STATES]),
      ),
    )
    .orderBy(desc(schema.plan.periodEnd));
  const people = yield* loadPeople(actor.tenantId, [personId]);
  const credits = yield* netCreditsBySkill(actor.tenantId, personId);
  const focus = new Set<SkillId>(
    current
      ? ((yield* loadPlanSkills(actor.tenantId, [current.id])).get(current.id) ?? []).map(
          (f) => f.skillId,
        )
      : [],
  );
  const other = [...credits.keys()].filter((id) => !focus.has(id));
  return {
    person: personFrom(people, personId),
    plan: current ? yield* buildPlanView(actor, current.id) : null,
    pastPlans: past.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status as PlanStatus,
      periodEnd: p.periodEnd,
    })),
    otherProgress: yield* progressFor(actor.tenantId, personId, other),
  } satisfies DevelopmentView;
});

export const canViewDevelopmentOf = Effect.fn('development.access')(function* (
  actor: Actor,
  subjectId: PersonId,
) {
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  return (
    developmentAccess(facts, { viewerId: actor.personId, subjectId, on: yield* today }) !== 'none'
  );
});

export const buildInteractionView = Effect.fn('development.interactionView')(function* (
  actor: Actor,
  interactionId: InteractionId,
) {
  const db = yield* Db;
  const [interaction] = yield* db
    .select()
    .from(schema.interaction)
    .where(
      and(
        eq(schema.interaction.tenantId, actor.tenantId),
        eq(schema.interaction.id, interactionId),
      ),
    );
  if (!interaction) return undefined;
  const [activity] = yield* db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.id, interaction.activityId));
  const [evidence] = yield* db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.interactionId, interaction.id))
    .orderBy(desc(schema.evidence.createdAt));
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const eligible = eligibleObserversOf(facts, interaction.ownerId, interaction.occurredOn);
  const observations = yield* db
    .select()
    .from(schema.observation)
    .where(eq(schema.observation.interactionId, interaction.id));
  const priorObservers = new Set(
    [...(yield* netCreditsBySkill(actor.tenantId, interaction.ownerId)).values()]
      .flat()
      .map((r) => r.observerId),
  );
  const people = yield* loadPeople(actor.tenantId, [
    interaction.ownerId,
    ...eligible.map((e) => e.personId),
  ]);
  const isAuthor = evidence?.authorId === actor.personId;
  return {
    id: interaction.id,
    activityId: interaction.activityId,
    activityTitle: activity?.title ?? 'Activity',
    occurredOn: interaction.occurredOn,
    kind: interaction.kind as InteractionKind,
    clientRef: interaction.clientRef,
    owner: personFrom(people, interaction.ownerId),
    evidence: evidence
      ? {
          status: evidence.status as EvidenceStatus,
          body: evidence.status === 'held' && !isAuthor ? null : evidence.body,
          holdReason: evidence.holdReason,
        }
      : null,
    eligibleObservers: eligible.map((e) => ({
      person: personFrom(people, e.personId),
      basis: e.basis,
      hint:
        priorObservers.size > 0 && !priorObservers.has(e.personId)
          ? `Would count as a new observer`
          : null,
      alreadyAsked: observations.some(
        (o) =>
          o.observerId === e.personId &&
          [...OPEN_OBSERVATION_STATES, 'signed'].includes(o.status as never),
      ),
    })),
  } satisfies InteractionView;
});
