import type { Actor, FeedItem, HomeView } from '@repo/api';
import {
  CURRENT_PLAN_STATES,
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
import { addDaysIso } from '../../platform/time.ts';
import { mondayOf } from '../shared/weeks.ts';
import { firstName, loadPeople, personFrom } from '../shared/people.ts';
import { loadSkills, toSkillRef } from '../shared/skills.ts';

/**
 * "Worth observing" on Home: a few people the viewer could observe this week,
 * each with a reason. Needs no calendar: plans already record due dates and
 * intended observers. Anyone with an open request or draft is left out; they
 * already wait under "Waiting on you".
 */
const SIGNED = ['signed', 'under_review'] as const;

/** What the suggestions read: planned work naming the viewer, open requests, observations. */
const loadSuggestionRows = Effect.fn('support.brief.rows')(function* (
  actor: Actor,
  on: IsoDate,
  weekEnd: IsoDate,
  supportedIds: ReadonlyArray<PersonId>,
) {
  const db = yield* Db;
  const me = actor.personId;
  const [plannedForMe, waiting] = yield* Effect.all([
    db
      .select()
      .from(schema.activity)
      .where(
        and(
          eq(schema.activity.tenantId, actor.tenantId),
          eq(schema.activity.intendedObserverId, me),
          inArray(schema.activity.status, ['planned', 'underway']),
          gte(schema.activity.dueOn, on),
          lt(schema.activity.dueOn, weekEnd),
        ),
      ),
    db
      .select({ subjectId: schema.observation.subjectId })
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
  return { plannedForMe, waiting, plans, observedRows };
});

export const worthObserving = Effect.fn('support.brief')(function* (
  actor: Actor,
  facts: RelationshipFacts,
  on: IsoDate,
) {
  const me = actor.personId;
  // The business week (tenant time zone, I32) that `on` falls in.
  const weekEnd = addDaysIso(mondayOf(on), 7);

  // People the viewer can observe today: reports, coachees and designations.
  const designated = (facts.designations ?? [])
    .filter((d) => d.observerId === me && d.from <= on && (d.to === null || on < d.to))
    .map((d) => d.subjectId);
  const reports = directReportsOf(facts, me, on);
  const supportedIds = [...new Set([...reports, ...coacheesOf(facts, me, on), ...designated])];
  if (supportedIds.length === 0) return [];

  const { plannedForMe, waiting, plans, observedRows } = yield* loadSuggestionRows(
    actor,
    on,
    weekEnd,
    supportedIds,
  );
  const skills = yield* loadSkills(
    actor.tenantId,
    plans.map((p) => p.skillId),
  );
  const people = yield* loadPeople(actor.tenantId, [
    ...supportedIds,
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
    alreadyWaiting: waiting.map((o) => o.subjectId),
    plannedThisWeek: plannedForMe.flatMap((a) =>
      a.dueOn ? [{ subjectId: a.ownerId, dueOn: a.dueOn }] : [],
    ),
  });
  return suggestions.map((s): HomeView['toObserve'][number] => ({
    person: personFrom(people, s.personId),
    reason: s.reason,
    sentence: s.sentence,
    href: `/people/${s.personId}`,
  }));
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
