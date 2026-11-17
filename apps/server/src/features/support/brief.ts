import type { Actor, FeedItem, PersonSummary, ThisWeek, TodayItem } from '@repo/api';
import {
  CURRENT_PLAN_STATES,
  DEFAULT_OBSERVE_CAPACITY,
  LEVEL_NAMES,
  coacheesOf,
  directReportsOf,
  whoToObserve,
  type IsoDate,
  type Level,
  type PersonId,
  type RelationshipFacts,
  type SkillId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { Effect } from 'effect';
import { BusinessTimeZone, addDaysIso, businessDateIn } from '../../platform/time.ts';
import { coverageSentence } from '../shared/notification-templates.ts';
import { mondayOf } from '../shared/weeks.ts';
import { firstName, loadPeople, personFrom } from '../shared/people.ts';
import { loadSkills, toSkillRef } from '../shared/skills.ts';

/**
 * The daily brief (path-to-A § 2): "Today" and "This week" on Home. Needs no
 * calendar: plans already record due dates and intended observers.
 */
const SIGNED = ['signed', 'under_review'] as const;

type BriefRows = Effect.Success<ReturnType<typeof loadBriefRows>>;

/** What the brief reads: planned and due work, requests, observations. */
const loadBriefRows = Effect.fn('support.brief.rows')(function* (
  actor: Actor,
  on: IsoDate,
  weekEnd: IsoDate,
  supportedIds: ReadonlyArray<PersonId>,
) {
  const db = yield* Db;
  const me = actor.personId;
  const tenant = eq(schema.activity.tenantId, actor.tenantId);
  const [plannedForMe, myDue, openRequests] = yield* Effect.all([
    db
      .select()
      .from(schema.activity)
      .where(
        and(
          tenant,
          eq(schema.activity.intendedObserverId, me),
          inArray(schema.activity.status, ['planned', 'underway']),
          gte(schema.activity.dueOn, on),
          lt(schema.activity.dueOn, weekEnd),
        ),
      ),
    db
      .select()
      .from(schema.activity)
      .where(
        and(
          tenant,
          eq(schema.activity.ownerId, me),
          inArray(schema.activity.status, ['planned', 'underway']),
          eq(schema.activity.dueOn, on),
        ),
      ),
    db
      .select()
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.tenantId, actor.tenantId),
          eq(schema.observation.observerId, me),
          // Waiting on the viewer: requests and drafts. A returned request waits on its subject.
          inArray(schema.observation.status, ['requested', 'drafting']),
        ),
      ),
  ]);

  // Focus skills of the people the viewer supports, and when each was last observed.
  const plans = supportedIds.length
    ? yield* db
        .select({ ownerId: schema.plan.ownerId, skillId: schema.planSkill.skillId })
        .from(schema.plan)
        .innerJoin(schema.planSkill, eq(schema.planSkill.planId, schema.plan.id))
        .where(
          and(
            eq(schema.plan.tenantId, actor.tenantId),
            inArray(schema.plan.ownerId, [...supportedIds]),
            inArray(schema.plan.status, [...CURRENT_PLAN_STATES]),
          ),
        )
    : [];
  const observedRows = supportedIds.length
    ? yield* db
        .select({
          subjectId: schema.observation.subjectId,
          observerId: schema.observation.observerId,
          skillId: schema.observationRating.skillId,
          occurredOn: schema.interaction.occurredOn,
        })
        .from(schema.observation)
        .innerJoin(
          schema.observationRating,
          eq(schema.observationRating.observationId, schema.observation.id),
        )
        .innerJoin(schema.interaction, eq(schema.interaction.id, schema.observation.interactionId))
        .where(
          and(
            eq(schema.observation.tenantId, actor.tenantId),
            inArray(schema.observation.subjectId, [...supportedIds]),
            inArray(schema.observation.status, [...SIGNED]),
          ),
        )
    : [];
  return { plannedForMe, myDue, openRequests, plans, observedRows };
});

/** "Today": planned observations for today, and the viewer's own due work. */
const todayItems = (
  rows: BriefRows,
  people: ReadonlyMap<PersonId, PersonSummary>,
  on: IsoDate,
): Array<TodayItem> => {
  const { plannedForMe, myDue } = rows;
  return [
    ...plannedForMe
      .filter((a) => a.dueOn === on)
      .map((a): TodayItem => ({
        kind: 'planned_observation',
        id: a.id,
        title: `Observe ${personFrom(people, a.ownerId).displayName}: ${a.title}`,
        person: personFrom(people, a.ownerId),
        on,
        href: `/observe?person=${a.ownerId}&activity=${a.id}`,
      })),
    ...myDue.map((a): TodayItem => ({
      kind: 'activity_due',
      id: a.id,
      title: a.title,
      person: null,
      on,
      href: `/log?activity=${a.id}`,
    })),
  ];
};

/** For leaders: how many reports someone observed in the last six weeks. */
const coverageSentenceFor = (
  reports: ReadonlyArray<PersonId>,
  observedRows: BriefRows['observedRows'],
  on: IsoDate,
): string | null => {
  if (reports.length === 0) return null;
  const since = addDaysIso(on, -42);
  const recent = new Set(
    observedRows
      .filter((r) => reports.includes(r.subjectId) && r.occurredOn >= since)
      .map((r) => r.subjectId),
  );
  return coverageSentence(recent.size, reports.length);
};

export const buildBrief = Effect.fn('support.brief')(function* (
  actor: Actor,
  facts: RelationshipFacts,
  on: IsoDate,
) {
  const me = actor.personId;
  const zone = yield* BusinessTimeZone;
  const weekOf = mondayOf(on);
  const weekEnd = addDaysIso(weekOf, 7);

  // People the viewer can observe today: reports, coachees and designations.
  const designated = (facts.designations ?? [])
    .filter((d) => d.observerId === me && d.from <= on && (d.to === null || on < d.to))
    .map((d) => d.subjectId);
  const reports = directReportsOf(facts, me, on);
  const supportedIds = [...new Set([...reports, ...coacheesOf(facts, me, on), ...designated])];

  const rows = yield* loadBriefRows(actor, on, weekEnd, supportedIds);
  const { plannedForMe, openRequests, plans, observedRows } = rows;
  const skills = yield* loadSkills(
    actor.tenantId,
    plans.map((p) => p.skillId),
  );
  const people = yield* loadPeople(actor.tenantId, [
    ...supportedIds,
    ...openRequests.map((o) => o.subjectId),
    ...plannedForMe.map((a) => a.ownerId),
  ]);
  const lastObserved = (personId: PersonId, skillId: SkillId) =>
    observedRows
      .filter((r) => r.subjectId === personId && r.skillId === skillId)
      .map((r) => r.occurredOn)
      .toSorted()
      .at(-1) ?? null;

  const suggestions = whoToObserve({
    viewerId: me,
    today: on,
    capacity: DEFAULT_OBSERVE_CAPACITY,
    supported: supportedIds.map((personId) => ({
      personId,
      firstName: firstName(personFrom(people, personId).displayName),
      focusSkills: plans
        .filter((p) => p.ownerId === personId)
        .map((p) => ({
          name: skills.get(p.skillId)?.name ?? 'focus skill',
          lastObservedOn: lastObserved(personId, p.skillId),
        })),
      distinctObservers: [
        ...new Set(observedRows.filter((r) => r.subjectId === personId).map((r) => r.observerId)),
      ],
    })),
    // Only what someone asked for; the viewer's own "I saw this" drafts are not requests.
    openRequests: openRequests
      .filter((o) => o.requestedById !== me)
      .map((o) => ({ subjectId: o.subjectId, dueOn: businessDateIn(o.dueAt, zone) })),
    plannedThisWeek: plannedForMe.flatMap((a) =>
      a.dueOn ? [{ subjectId: a.ownerId, dueOn: a.dueOn }] : [],
    ),
  });

  const thisWeek: ThisWeek = {
    weekOf,
    toObserve: suggestions.map((s) => ({
      person: personFrom(people, s.personId),
      reason: s.reason,
      sentence: s.sentence,
      href: `/people/${s.personId}`,
    })),
    coverageSentence: coverageSentenceFor(reports, observedRows, on),
  };
  return { today: todayItems(rows, people, on), thisWeek };
});

/** Closes the loop for observers: the subject read what they wrote (last 14 days). */
export const readReceipts = Effect.fn('support.readReceipts')(function* (
  actor: Actor,
  on: IsoDate,
) {
  const db = yield* Db;
  const rows = yield* db
    .select({
      id: schema.observation.id,
      subjectId: schema.observation.subjectId,
      acknowledgedAt: schema.observation.acknowledgedAt,
      skillId: schema.observationRating.skillId,
      level: schema.observationRating.level,
    })
    .from(schema.observation)
    .innerJoin(
      schema.observationRating,
      eq(schema.observationRating.observationId, schema.observation.id),
    )
    .where(
      and(
        eq(schema.observation.tenantId, actor.tenantId),
        eq(schema.observation.observerId, actor.personId),
        isNotNull(schema.observation.acknowledgedAt),
        gte(schema.observation.acknowledgedAt, new Date(`${addDaysIso(on, -14)}T00:00:00Z`)),
        isNotNull(schema.observationRating.level),
      ),
    )
    .orderBy(desc(schema.observation.acknowledgedAt));
  const first = rows.filter((r, i) => rows.findIndex((o) => o.id === r.id) === i);
  const people = yield* loadPeople(actor.tenantId, [
    actor.personId,
    ...first.map((r) => r.subjectId),
  ]);
  const skills = yield* loadSkills(
    actor.tenantId,
    first.map((r) => r.skillId),
  );
  return first.flatMap((r): Array<FeedItem> => {
    const skill = skills.get(r.skillId);
    if (!skill || !r.acknowledgedAt) return [];
    return [
      {
        kind: 'read_by_subject',
        at: r.acknowledgedAt.toISOString(),
        person: personFrom(people, r.subjectId),
        observer: personFrom(people, actor.personId),
        skill: toSkillRef(skill),
        level: r.level as number,
        levelName: LEVEL_NAMES[r.level as Level],
        quote: null,
        href: `/observations/${r.id}`,
      },
    ];
  });
});
