import type {
  Actor,
  ActivitySkillView,
  ActivityView,
  DevelopmentView,
  FocusSkillView,
  InteractionSummary,
  InteractionView,
  PlanView,
  PersonSummary,
  WorkTemplate,
} from '@repo/api';
import {
  ActivityLifecycle,
  BADGE_LEVELS,
  CURRENT_PLAN_STATES,
  LEVEL_NAMES,
  OPEN_OBSERVATION_STATES,
  PlanLifecycle,
  isEvidenceHeld,
  resolveCreditValue,
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
  type CreditPolicy,
  type PlanEventType,
  type PlanId,
  type PlanOutcome,
  type PlanStatus,
  type RelationshipFacts,
  type SkillId,
  type SkillRole,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { BusinessTimeZone, now, today } from '../../platform/time.ts';
import { loadPeople, personFrom } from '../shared/people.ts';
import { netCreditsBySkill, progressFor, tenantCreditPolicy } from '../shared/recognition.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import {
  activitySkillValue,
  loadActivitySkillRows,
  loadPlanSkills,
  type ActivitySkillRow,
  type PlanSkillRow,
} from '../shared/catalog-reads.ts';
import { currentPlanOf, planAgreers } from '../shared/plans.ts';
import { loadSkills, toSkillRef } from '../shared/skills.ts';
import { latestTryNextTime } from '../shared/try-next-time.ts';
import {
  editWorkRefusal,
  planCapabilities,
  planRelation,
  setValueRefusal,
  type PlanRelation,
} from './permissions.ts';
import { observedActivityIds } from './use-cases.ts';

type PlanRow = typeof schema.plan.$inferSelect;

/**
 * What the viewer may do with one piece of work: lifecycle events (the owner
 * only), and the flags from the same refusal functions the use cases call.
 */
const workCapabilities = (
  who: PlanRelation,
  plan: PlanRow,
  activity: typeof schema.activity.$inferSelect,
  policy: CreditPolicy,
  observed: boolean,
): Pick<ActivityView, 'actions' | 'canEdit' | 'canSetValue'> => ({
  actions: who.isOwner
    ? ActivityLifecycle.allowed(activity.status as ActivityStatus, {}, [
        { type: 'LOG_INTERACTION' },
        { type: 'COMPLETE' },
        { type: 'CANCEL' },
      ])
    : [],
  canEdit: editWorkRefusal(who, plan, activity) === null,
  canSetValue:
    setValueRefusal(who, policy.activityOverrides, plan, { ...activity, observed }) === null,
});
type SkillRow = typeof schema.skill.$inferSelect;
type CreditRow = typeof schema.creditEntry.$inferSelect;
type People = ReadonlyMap<PersonId, PersonSummary>;

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
    reviewConfirmed: plan.reviewConfirmedAt !== null,
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
        !isEvidenceHeld(ev?.status as EvidenceStatus | undefined) &&
        eligible.some((e) => !live.has(e.personId)),
      canReviseEvidence: ev?.authorId === viewerId && ev.status === 'held',
    });
  }
  return result;
});

/** Focus skills with their target, how far observation has reached and the review's outcome. */
const focusSkillViews = (
  focus: ReadonlyArray<PlanSkillRow>,
  skills: ReadonlyMap<SkillId, SkillRow>,
  credits: ReadonlyMap<SkillId, ReadonlyArray<CreditRow>>,
): Array<FocusSkillView> =>
  focus.flatMap((f) => {
    const row = skills.get(f.skillId);
    if (!row) return [];
    const mine = credits.get(f.skillId) ?? [];
    const atTarget = mine.filter((c) => c.level >= f.targetLevel);
    return [
      {
        skill: toSkillRef(row),
        targetLevel: f.targetLevel,
        targetLevelName: LEVEL_NAMES[f.targetLevel],
        targetHasBadge: (BADGE_LEVELS as ReadonlyArray<number>).includes(f.targetLevel),
        highestObservedLevel: mine.length > 0 ? Math.max(...mine.map((c) => c.level)) : null,
        observedAtTarget: new Set(atTarget.map((c) => c.interactionId)).size,
        outcome: f.outcome as PlanOutcome | null,
      },
    ];
  });

const reviewView = (plan: PlanRow, people: People): PlanView['review'] =>
  plan.reviewRecordedById && plan.reviewRecordedAt
    ? {
        recordedBy: personFrom(people, plan.reviewRecordedById),
        recordedAt: plan.reviewRecordedAt.toISOString(),
        confirmedBy: plan.reviewConfirmedById ? personFrom(people, plan.reviewConfirmedById) : null,
        confirmedAt: plan.reviewConfirmedAt?.toISOString() ?? null,
      }
    : null;

const reviewPeople = (plan: PlanRow): Array<PersonId> => [
  ...(plan.reviewRecordedById ? [plan.reviewRecordedById] : []),
  ...(plan.reviewConfirmedById ? [plan.reviewConfirmedById] : []),
];

/**
 * Each skill of a piece of work with what one signed observation of work done
 * today and logged now would add, resolved with the same domain function
 * signing uses. An individual value shows when it was set: it reaches work
 * logged from that moment, done that day or later.
 */
const activitySkillViews = (
  rows: ReadonlyArray<ActivitySkillRow>,
  skills: ReadonlyMap<SkillId, SkillRow>,
  policy: CreditPolicy,
  people: People,
  context: { readonly on: IsoDate; readonly at: Date; readonly timeZone: string },
): Array<ActivitySkillView> =>
  rows.flatMap((row) => {
    const skill = skills.get(row.skillId);
    if (!skill) return [];
    const role = row.role as SkillRole;
    const activity = activitySkillValue(row, context.timeZone);
    const work = { on: context.on, loggedAt: context.at };
    return [
      {
        skill: toSkillRef(skill),
        role,
        value: resolveCreditValue({ role, policy, work, activity, skill }),
        override:
          row.pointsOverride !== null &&
          row.pointsOverrideById &&
          row.pointsOverrideAt &&
          activity.pointsOverrideFrom
            ? {
                points: row.pointsOverride,
                setBy: personFrom(people, row.pointsOverrideById),
                setAt: row.pointsOverrideAt.toISOString(),
                appliesFrom: activity.pointsOverrideFrom,
              }
            : null,
        valueWithoutOverride: resolveCreditValue({
          role,
          policy,
          work,
          activity: {
            ...activity,
            pointsOverride: null,
            pointsOverrideAt: null,
            pointsOverrideFrom: null,
          },
          skill,
        }),
      },
    ];
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
  const activitySkills = yield* loadActivitySkillRows(
    actor.tenantId,
    activities.map((a) => a.id),
  );
  const policy = yield* tenantCreditPolicy(actor.tenantId);
  const observed = yield* observedActivityIds(
    actor.tenantId,
    activities.map((a) => a.id),
  );
  const focusCredits = yield* netCreditsBySkill(
    actor.tenantId,
    plan.ownerId,
    focus.map((f) => f.skillId),
  );
  const coachId = coachesOf(facts, plan.ownerId, on)[0];
  const leaderId = leaderOf(facts, plan.ownerId, on);
  const tryNext = yield* latestTryNextTime(actor, facts, plan.ownerId, on);
  const people = yield* loadPeople(actor.tenantId, [
    plan.ownerId,
    ...(tryNext ? [tryNext.observerId] : []),
    ...(coachId ? [coachId] : []),
    ...(leaderId ? [leaderId] : []),
    ...(plan.agreedById ? [plan.agreedById] : []),
    ...(plan.endorsedById ? [plan.endorsedById] : []),
    ...reviewPeople(plan),
    ...activities.flatMap((a) => (a.intendedObserverId ? [a.intendedObserverId] : [])),
    ...[...activitySkills.values()]
      .flat()
      .flatMap((r) => (r.pointsOverrideById ? [r.pointsOverrideById] : [])),
  ]);
  const skills = yield* loadSkills(actor.tenantId, [
    ...focus.map((f) => f.skillId),
    ...[...activitySkills.values()].flat().map((r) => r.skillId),
  ]);
  const templates = yield* loadTemplates(
    actor.tenantId,
    activities.flatMap((a) => (a.templateId ? [a.templateId] : [])),
  );
  const who: PlanRelation = planRelation(actor, plan.ownerId, facts, on);
  const values = { on, at: yield* now, timeZone: yield* BusinessTimeZone };

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
    skills: activitySkillViews(activitySkills.get(a.id) ?? [], skills, policy, people, values),
    intendedObserver: a.intendedObserverId ? (people.get(a.intendedObserverId) ?? null) : null,
    intendedMode: (a.intendedMode as ObservationMode | null) ?? null,
    interactions: interactions.flatMap((i) => {
      const summary = i.activityId === a.id ? summaries.get(i.id) : undefined;
      return summary ? [summary] : [];
    }),
    ...workCapabilities(who, plan, a, policy, observed.has(a.id)),
    version: a.version,
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
    focusSkills: focusSkillViews(focus, skills, focusCredits),
    agreedBy: optional(plan.agreedById),
    agreedAt: plan.agreedAt?.toISOString() ?? null,
    endorsedBy: optional(plan.endorsedById),
    closingSummary: plan.closingSummary,
    review: reviewView(plan, people),
    tryNextTime: tryNext
      ? {
          sentence: tryNext.sentence,
          observer: personFrom(people, tryNext.observerId),
          signedAt: tryNext.signedAt.toISOString(),
          observationId: tryNext.observationId,
        }
      : null,
    activities: activityViews,
    progress: yield* progressFor(
      actor.tenantId,
      plan.ownerId,
      focus.map((f) => f.skillId),
    ),
    actions: planActions(plan, focus.length, activities.length, actor.personId, facts, on),
    ...planCapabilities(who, plan),
    valueRange: policy.activityOverrides.enabled
      ? { min: policy.activityOverrides.minPoints, max: policy.activityOverrides.maxPoints }
      : null,
    version: plan.version,
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

/**
 * Published templates with their own published skills, roles and values, for
 * planning work. Adding work copies these; signing never reads the template.
 */
export const buildWorkTemplates = Effect.fn('development.workTemplates')(function* (
  tenantId: TenantId,
) {
  const db = yield* Db;
  const templates = yield* db
    .select()
    .from(schema.activityTemplate)
    .where(
      and(
        eq(schema.activityTemplate.tenantId, tenantId),
        eq(schema.activityTemplate.status, 'published'),
      ),
    )
    .orderBy(schema.activityTemplate.name);
  const rows = templates.length
    ? yield* db
        .select({ link: schema.activityTemplateSkill, skill: schema.skill })
        .from(schema.activityTemplateSkill)
        .innerJoin(
          schema.skill,
          and(
            eq(schema.skill.tenantId, schema.activityTemplateSkill.tenantId),
            eq(schema.skill.id, schema.activityTemplateSkill.skillId),
          ),
        )
        .where(
          and(
            eq(schema.activityTemplateSkill.tenantId, tenantId),
            inArray(
              schema.activityTemplateSkill.templateId,
              templates.map((t) => t.id),
            ),
            eq(schema.skill.status, 'published'),
          ),
        )
        .orderBy(schema.activityTemplateSkill.position)
    : [];
  return templates.map((t): WorkTemplate => ({
    id: t.id,
    name: t.name,
    description: t.description,
    kind: t.kind as InteractionKind,
    observationTip: t.observationTip,
    skills: rows
      .filter((r) => r.link.templateId === t.id)
      .map((r) => ({
        skill: toSkillRef(r.skill),
        role: r.link.role as SkillRole,
        points: r.link.points,
      })),
  }));
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
  const people = yield* loadPeople(actor.tenantId, [personId, ...past.flatMap(reviewPeople)]);
  const credits = yield* netCreditsBySkill(actor.tenantId, personId);
  const pastFocus = yield* loadPlanSkills(
    actor.tenantId,
    past.map((p) => p.id),
  );
  const pastSkills = yield* loadSkills(
    actor.tenantId,
    [...pastFocus.values()].flat().map((f) => f.skillId),
  );
  const who = planRelation(
    actor,
    personId,
    yield* loadRelationshipFacts(actor.tenantId),
    yield* today,
  );
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
    pastPlans: past.map((p) => {
      const { canRecordReview, canConfirmReview } = planCapabilities(who, p);
      return {
        id: p.id,
        title: p.title,
        status: p.status as PlanStatus,
        periodEnd: p.periodEnd,
        focusSkills: focusSkillViews(pastFocus.get(p.id) ?? [], pastSkills, credits),
        closingSummary: p.closingSummary,
        review: reviewView(p, people),
        canRecordReview,
        canConfirmReview,
        version: p.version,
      };
    }),
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
  const listed = (yield* loadActivitySkillRows(actor.tenantId, [interaction.activityId])).get(
    interaction.activityId,
  );
  const listedSkills = yield* loadSkills(
    actor.tenantId,
    (listed ?? []).map((r) => r.skillId),
  );
  const policy = yield* tenantCreditPolicy(actor.tenantId);
  return {
    id: interaction.id,
    activityId: interaction.activityId,
    activityTitle: activity?.title ?? 'Work',
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
    // Primary first: the defaults a request starts from.
    skills: (listed ?? [])
      .toSorted((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary'))
      .flatMap((r) => {
        const skill = listedSkills.get(r.skillId);
        return skill ? [{ skill: toSkillRef(skill), role: r.role as SkillRole }] : [];
      }),
    maxSkills: policy.maxSkillsPerObservation,
  } satisfies InteractionView;
});
