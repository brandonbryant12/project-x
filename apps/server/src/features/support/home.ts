import type { Actor, FeedItem, HomeView, PersonSummary, QueueItem } from '@repo/api';
import {
  LEVEL_NAMES,
  OPEN_OBSERVATION_STATES,
  coacheesOf,
  coachesOf,
  directReportsOf,
  eligibleObserversOf,
  leaderOf,
  type IsoDate,
  type Level,
  type ObserverBasis,
  type PersonId,
  type PlanStatus,
  type RelationshipFacts,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, gte, inArray, ne, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDaysIso, today } from '../../platform/time.ts';
import { loadPlanSkills } from '../shared/catalog-reads.ts';
import { firstName, loadPeople, personFrom } from '../shared/people.ts';
import { progressFor } from '../shared/recognition.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import { loadSkills, refsFor, toSkillRef } from '../shared/skills.ts';
import { currentPlanOf, planAgreers } from '../shared/plans.ts';
import { MIN_CELL, planCoverage } from '../shared/program.ts';
import { readReceipts, worthObserving } from './brief.ts';

/** One recognition moment per person and skill: the highest level earned (independent review). */
const highestPerSkill = <B extends { personId: string; skillId: string; level: number }>(
  badges: ReadonlyArray<B>,
) =>
  badges.filter(
    (b) =>
      !badges.some(
        (o) => o.personId === b.personId && o.skillId === b.skillId && o.level > b.level,
      ),
  );

/** How the observer relates to the person who asked, in plain words. */
const BASIS_RELATION: Record<ObserverBasis, string> = {
  leader: 'Your report',
  coach: 'You coach them',
  designated: 'You were asked to observe them',
};

/** "Thu, Nov 12": the queue reads like a person wrote it. */
const humanDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

const firstSentence = (text: string | null) => {
  if (!text) return null;
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence;
};

type QueueRows = Effect.Success<ReturnType<typeof loadQueueRows>>;

/** What waits on the viewer: requests, returns, plans and engagements, holds, unrequested work. */
const loadQueueRows = Effect.fn('support.home.queueRows')(function* (
  actor: Actor,
  facts: RelationshipFacts,
  on: IsoDate,
) {
  const db = yield* Db;
  const me = actor.personId;
  const [observeQueue, returned, myInteractions, held, proposedPlans, proposals] =
    yield* Effect.all([
      db
        .select()
        .from(schema.observation)
        .where(
          and(
            eq(schema.observation.observerId, me),
            inArray(schema.observation.status, ['requested', 'drafting']),
          ),
        ),
      db
        .select()
        .from(schema.observation)
        .where(
          and(eq(schema.observation.subjectId, me), eq(schema.observation.status, 'returned')),
        ),
      db
        .select()
        .from(schema.interaction)
        .where(
          and(
            eq(schema.interaction.ownerId, me),
            gte(schema.interaction.occurredOn, addDaysIso(on, -30)),
          ),
        ),
      db
        .select()
        .from(schema.evidence)
        .where(and(eq(schema.evidence.authorId, me), eq(schema.evidence.status, 'held'))),
      db
        .select()
        .from(schema.plan)
        .where(and(eq(schema.plan.tenantId, actor.tenantId), eq(schema.plan.status, 'proposed'))),
      db
        .select()
        .from(schema.engagement)
        .where(
          and(
            eq(schema.engagement.status, 'proposed'),
            or(eq(schema.engagement.coachId, me), eq(schema.engagement.coacheeId, me)),
            ne(schema.engagement.proposedById, me),
          ),
        ),
    ]);
  const plansToAgree = proposedPlans.filter((p) => planAgreers(facts, p.ownerId, on).includes(me));
  const observed = myInteractions.length
    ? yield* db
        .select({ interactionId: schema.observation.interactionId })
        .from(schema.observation)
        .where(
          and(
            inArray(
              schema.observation.interactionId,
              myInteractions.map((i) => i.id),
            ),
            inArray(schema.observation.status, [
              ...OPEN_OBSERVATION_STATES,
              'signed',
              'under_review',
            ]),
          ),
        )
    : [];
  const unrequested = myInteractions.filter((i) => !observed.some((o) => o.interactionId === i.id));
  return { observeQueue, returned, held, proposals, plansToAgree, unrequested };
});

/** Queue items from the rows, soonest due first. */
const toQueue = (
  { observeQueue, returned, held, proposals, plansToAgree, unrequested }: QueueRows,
  people: ReadonlyMap<PersonId, PersonSummary>,
  facts: RelationshipFacts,
  me: PersonId,
  on: IsoDate,
): Array<QueueItem> =>
  [
    ...observeQueue.map((o): QueueItem => ({
      kind: o.status === 'drafting' ? 'continue_draft' : 'sign_observation',
      id: o.id,
      title:
        o.status === 'drafting'
          ? `Finish your observation of ${personFrom(people, o.subjectId).displayName}`
          : `${personFrom(people, o.subjectId).displayName} asked you to observe`,
      detail: null,
      person: personFrom(people, o.subjectId),
      relation: BASIS_RELATION[o.basis as ObserverBasis],
      dueAt: o.dueAt.toISOString(),
      href: `/observations/${o.id}`,
      actionLabel: o.status === 'drafting' ? 'Continue' : 'Open',
    })),
    ...returned.map((o): QueueItem => ({
      kind: 'revise_returned',
      id: o.id,
      title: `${personFrom(people, o.observerId).displayName} sent an observation back`,
      detail: null,
      person: personFrom(people, o.observerId),
      relation: 'Your request',
      dueAt: o.dueAt.toISOString(),
      href: `/observations/${o.id}`,
      actionLabel: 'Review',
    })),
    ...plansToAgree.map((p): QueueItem => ({
      kind: 'agree_plan',
      id: p.id,
      title: `${personFrom(people, p.ownerId).displayName} proposed a plan`,
      detail: p.title,
      person: personFrom(people, p.ownerId),
      relation: coacheesOf(facts, me, on).includes(p.ownerId) ? 'You coach them' : 'Your report',
      dueAt: null,
      href: `/team/${p.ownerId}`,
      actionLabel: 'Review plan',
    })),
    ...proposals.map((e): QueueItem => ({
      kind: 'accept_engagement',
      id: e.id,
      title: `${personFrom(people, e.proposedById).displayName} proposed a coaching engagement`,
      detail: e.note,
      person: personFrom(people, e.proposedById),
      relation: e.coachId === me ? 'Wants you as coach' : 'Offers to coach you',
      dueAt: e.expiresAt?.toISOString() ?? null,
      href: '/coaching',
      actionLabel: 'Respond',
    })),
    ...held.map((e): QueueItem => ({
      kind: 'held_evidence',
      id: e.id,
      title: 'A reflection is held for privacy',
      detail: 'Remove client names or account details so it can be shared.',
      person: null,
      relation: 'Your plan',
      dueAt: null,
      href: '/development',
      actionLabel: 'Revise',
    })),
    ...unrequested.slice(0, 3).map((i): QueueItem => ({
      kind: 'request_observation',
      id: i.id,
      title: 'Nobody has been asked to observe this yet',
      detail: `Logged for ${humanDate(i.occurredOn)}`,
      person: null,
      relation: 'Your plan',
      dueAt: null,
      href: `/log?interaction=${i.id}`,
      actionLabel: 'Ask someone',
    })),
  ].toSorted((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));

/** "Needs you": one merged queue across every relationship. */
const needsYouQueue = Effect.fn('support.home.queue')(function* (
  actor: Actor,
  facts: RelationshipFacts,
  on: IsoDate,
) {
  const rows = yield* loadQueueRows(actor, facts, on);
  const { observeQueue, returned, proposals, plansToAgree } = rows;
  const people = yield* loadPeople(actor.tenantId, [
    ...observeQueue.map((o) => o.subjectId),
    ...returned.map((o) => o.observerId),
    ...plansToAgree.map((p) => p.ownerId),
    ...proposals.map((e) => e.proposedById),
  ]);
  return toQueue(rows, people, facts, actor.personId, on);
});

/** The next step (first unmet benchmark) and a summary of the current plan. */
const planSummary = Effect.fn('support.home.plan')(function* (actor: Actor) {
  const db = yield* Db;
  const me = actor.personId;
  const plan = yield* currentPlanOf(actor.tenantId, me);
  const focus = plan ? ((yield* loadPlanSkills(actor.tenantId, [plan.id])).get(plan.id) ?? []) : [];
  const progress = yield* progressFor(
    actor.tenantId,
    me,
    focus.map((f) => f.skillId),
  );
  const next = progress.find((p) => p.criteria.some((c) => !c.met)) ?? progress[0];
  const nextStep = next ? { skill: next.skill, sentence: next.nextStep } : null;
  if (!plan) return { nextStep, plan: null, progress };
  const activities = yield* db
    .select({ id: schema.activity.id })
    .from(schema.activity)
    .where(eq(schema.activity.planId, plan.id));
  const skills = yield* loadSkills(
    actor.tenantId,
    focus.map((f) => f.skillId),
  );
  return {
    nextStep,
    progress,
    plan: {
      id: plan.id,
      title: plan.title,
      status: plan.status as PlanStatus,
      periodEnd: plan.periodEnd,
      focusSkills: refsFor(
        skills,
        focus.map((f) => f.skillId),
      ),
      activityCount: activities.length,
      observedCount: progress.reduce((n, p) => n + p.demonstrations, 0),
    },
  };
});

/** "Recently": words written about the viewer, badges they and their people earned, receipts. */
const recentFeed = Effect.fn('support.home.feed')(function* (
  actor: Actor,
  facts: RelationshipFacts,
  on: IsoDate,
) {
  const db = yield* Db;
  const me = actor.personId;
  const supported = [...directReportsOf(facts, me, on), ...coacheesOf(facts, me, on)];
  const since = new Date(Date.now() - 45 * 86_400_000);
  const [signedAboutMe, badges] = yield* Effect.all([
    db
      .select()
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.subjectId, me),
          eq(schema.observation.status, 'signed'),
          gte(schema.observation.signedAt, since),
        ),
      )
      .orderBy(desc(schema.observation.signedAt))
      .limit(4),
    db
      .select()
      .from(schema.badgeAward)
      .where(
        and(
          inArray(schema.badgeAward.personId, [me, ...supported] as Array<PersonId>),
          eq(schema.badgeAward.status, 'awarded'),
          gte(schema.badgeAward.awardedAt, since),
        ),
      )
      .orderBy(desc(schema.badgeAward.awardedAt))
      .limit(4),
  ]);
  const ratings = signedAboutMe.length
    ? yield* db
        .select()
        .from(schema.observationRating)
        .where(
          inArray(
            schema.observationRating.observationId,
            signedAboutMe.map((o) => o.id),
          ),
        )
    : [];
  const skills = yield* loadSkills(actor.tenantId, [
    ...ratings.map((r) => r.skillId),
    ...badges.map((b) => b.skillId),
  ]);
  const feedPeopleIds = [
    ...signedAboutMe.map((o) => o.observerId),
    ...badges.map((b) => b.personId),
    me,
  ];
  const feedPeople = yield* loadPeople(actor.tenantId, feedPeopleIds);
  const recently: Array<FeedItem> = [
    ...signedAboutMe.flatMap((o): Array<FeedItem> => {
      const rating = ratings.find((r) => r.observationId === o.id && r.level !== null);
      const skill = rating ? skills.get(rating.skillId) : undefined;
      if (!rating || !skill || !o.signedAt) return [];
      return [
        {
          kind: 'signed_about_you',
          at: o.signedAt.toISOString(),
          person: personFrom(feedPeople, me),
          observer: personFrom(feedPeople, o.observerId),
          skill: toSkillRef(skill),
          level: rating.level as number,
          levelName: LEVEL_NAMES[rating.level as Level],
          quote: firstSentence(o.narrativeSaw),
          href: `/observations/${o.id}`,
        },
      ];
    }),
    ...highestPerSkill(badges).flatMap((b): Array<FeedItem> => {
      const skill = skills.get(b.skillId);
      if (!skill) return [];
      return [
        {
          kind: b.personId === me ? 'badge_earned' : 'badge_earned_by_supported',
          at: b.awardedAt.toISOString(),
          person: personFrom(feedPeople, b.personId),
          observer: null,
          skill: toSkillRef(skill),
          level: b.level,
          levelName: LEVEL_NAMES[b.level as Level],
          quote: null,
          href: `/people/${b.personId}/badges/${b.id}`,
        },
      ];
    }),
    ...(yield* readReceipts(actor, on)),
  ].toSorted((a, b) => b.at.localeCompare(a.at));
  return recently;
});

/**
 * Home: what is waiting on this person across every relationship, their plan
 * with its next step, and what happened recently.
 */
export const buildHome = Effect.fn('support.home')(function* (actor: Actor) {
  const db = yield* Db;
  const on = yield* today;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const me = actor.personId;
  const queue = yield* needsYouQueue(actor, facts, on);
  const { nextStep, plan, progress } = yield* planSummary(actor);
  const recently = yield* recentFeed(actor, facts, on);
  const toObserve = yield* worthObserving(actor, facts, on);
  const coverage = actor.grants.includes('program_owner')
    ? yield* planCoverage(actor.tenantId, on)
    : null;
  const coachIds = coachesOf(facts, me, on);
  const leaderId = leaderOf(facts, me, on);
  const eligible = eligibleObserversOf(facts, me, on);
  const support = yield* loadPeople(actor.tenantId, [
    ...coachIds,
    ...(leaderId ? [leaderId] : []),
    ...eligible.map((e) => e.personId),
  ]);
  const [me$] = yield* db
    .select({ name: schema.person.displayName })
    .from(schema.person)
    .where(eq(schema.person.id, me));
  return {
    firstName: firstName(me$?.name ?? actor.displayName),
    needsYou: queue.slice(0, 5),
    needsYouTotal: queue.length,
    nextStep,
    recently: recently.slice(0, 6),
    plan,
    progress,
    eligibleObservers: eligible.map((e) => ({
      person: personFrom(support, e.personId),
      basis: e.basis,
    })),
    coaches: coachIds.map((id) => personFrom(support, id)),
    leader: leaderId ? personFrom(support, leaderId) : null,
    toObserve,
    programHealth: coverage
      ? {
          withPlan: coverage.withPlan,
          observedRecently: coverage.observed,
          minimumCell: MIN_CELL,
        }
      : null,
  } satisfies HomeView;
});
