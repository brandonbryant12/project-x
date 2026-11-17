import { CurrentActor, NotFound, type BadgeReceiptView, type PersonCard } from '@repo/api';
import {
  LEVEL_NAMES,
  canReadNarrative,
  checkObserverEligibility,
  criteriaFromSnapshot,
  developmentAccess,
  projectWork,
  proposableDirections,
  type BadgeAwardId,
  type Level,
  type ObservationMode,
  type PersonId,
  type PointsSource,
  type SkillId,
  type CreditRole,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, gte, ilike, inArray, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { today } from '../../platform/time.ts';
import { loadPlanSkills } from '../shared/catalog-reads.ts';
import { relationLabel } from '../shared/directory.ts';
import { loadPeople, personFrom, toPersonSummary } from '../shared/people.ts';
import { currentPlanOf } from '../shared/plans.ts';
import { netCreditsBySkill, progressFor, toCreditFact } from '../shared/recognition.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import { loadSkills, toSkillRef } from '../shared/skills.ts';

/** `GET /people` query: free text, optionally narrowed to holders of a badge. */
interface PeopleQuery {
  readonly q?: string | undefined;
  readonly skillId?: SkillId | undefined;
  readonly minLevel?: number | undefined;
}

const weeks = (days: number) => Math.max(1, Math.round(days / 7));

/** The directory search: active people in the tenant, with badges and relation. */
export const searchPeople = Effect.fn('people.search')(function* (query: PeopleQuery) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const conditions = [
    eq(schema.person.tenantId, actor.tenantId),
    eq(schema.person.status, 'active'),
  ];
  if (query.q) {
    const match = or(
      ilike(schema.person.displayName, `%${query.q}%`),
      ilike(schema.person.title, `%${query.q}%`),
    );
    if (match) conditions.push(match);
  }
  if (query.skillId) {
    const holders = yield* db
      .select({ personId: schema.badgeAward.personId })
      .from(schema.badgeAward)
      .where(
        and(
          eq(schema.badgeAward.tenantId, actor.tenantId),
          eq(schema.badgeAward.skillId, query.skillId),
          eq(schema.badgeAward.status, 'awarded'),
          gte(schema.badgeAward.level, query.minLevel ?? 2),
        ),
      );
    if (holders.length === 0) return [];
    conditions.push(
      inArray(
        schema.person.id,
        holders.map((h) => h.personId),
      ),
    );
  }
  const people = yield* db
    .select()
    .from(schema.person)
    .where(and(...conditions))
    .orderBy(schema.person.displayName)
    .limit(100);
  const ids = people.map((p) => p.id);
  const [functions, badges, facts] = yield* Effect.all([
    db
      .select()
      .from(schema.businessFunction)
      .where(eq(schema.businessFunction.tenantId, actor.tenantId)),
    ids.length
      ? db
          .select()
          .from(schema.badgeAward)
          .where(
            and(inArray(schema.badgeAward.personId, ids), eq(schema.badgeAward.status, 'awarded')),
          )
      : Effect.succeed([]),
    loadRelationshipFacts(actor.tenantId),
  ]);
  const skills = yield* loadSkills(
    actor.tenantId,
    badges.map((b) => b.skillId),
  );
  const on = yield* today;
  return people.map((p): PersonCard => ({
    person: toPersonSummary(p),
    businessFunction: functions.find((f) => f.id === p.businessFunctionId)?.name ?? null,
    location: p.location,
    badges: badges.flatMap((b) => {
      const skill = b.personId === p.id ? skills.get(b.skillId) : undefined;
      return skill ? [{ skill: toSkillRef(skill), level: b.level }] : [];
    }),
    relation: relationLabel(facts, actor.personId, p.id, on),
  }));
});

/** A person's profile; development is shown only when the viewer may see it. */
export const buildProfile = Effect.fn('people.profile')(function* (id: PersonId) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [person] = yield* db
    .select()
    .from(schema.person)
    .where(and(eq(schema.person.tenantId, actor.tenantId), eq(schema.person.id, id)));
  if (!person) return yield* Effect.fail(new NotFound({ entity: 'person', id: id }));
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const access = developmentAccess(facts, {
    viewerId: actor.personId,
    subjectId: person.id,
    on,
  });
  const badges = yield* db
    .select()
    .from(schema.badgeAward)
    .where(and(eq(schema.badgeAward.personId, person.id), eq(schema.badgeAward.status, 'awarded')))
    .orderBy(desc(schema.badgeAward.awardedAt));
  const skills = yield* loadSkills(
    actor.tenantId,
    badges.map((b) => b.skillId),
  );
  const [fn] = person.businessFunctionId
    ? yield* db
        .select()
        .from(schema.businessFunction)
        .where(eq(schema.businessFunction.id, person.businessFunctionId))
    : [];
  const visible = access !== 'none';
  const plan = visible ? yield* currentPlanOf(actor.tenantId, person.id) : undefined;
  const focus = plan
    ? ((yield* loadPlanSkills(actor.tenantId, [plan.id])).get(plan.id) ?? []).map((f) => f.skillId)
    : [];
  const credited = visible ? [...(yield* netCreditsBySkill(actor.tenantId, person.id)).keys()] : [];
  const relation = relationLabel(facts, actor.personId, person.id, on);
  const live = yield* db
    .select({ coachId: schema.engagement.coachId, coacheeId: schema.engagement.coacheeId })
    .from(schema.engagement)
    .where(
      and(
        eq(schema.engagement.tenantId, actor.tenantId),
        inArray(schema.engagement.status, ['proposed', 'active', 'paused']),
        or(
          and(
            eq(schema.engagement.coachId, actor.personId),
            eq(schema.engagement.coacheeId, person.id),
          ),
          and(
            eq(schema.engagement.coachId, person.id),
            eq(schema.engagement.coacheeId, actor.personId),
          ),
        ),
      ),
    );
  return {
    person: toPersonSummary(person),
    email: person.email,
    businessFunction: fn?.name ?? null,
    location: person.location,
    relations: relation && relation !== 'You' ? [relation] : [],
    badges: badges.flatMap((b) => {
      const skill = skills.get(b.skillId);
      return skill
        ? [
            {
              id: b.id,
              skill: toSkillRef(skill),
              level: b.level,
              levelName: LEVEL_NAMES[b.level as Level],
              awardedAt: b.awardedAt.toISOString(),
            },
          ]
        : [];
    }),
    developmentVisible: visible,
    progress: visible
      ? yield* progressFor(actor.tenantId, person.id, [
          ...new Set([...focus, ...credited]),
        ] as Array<SkillId>)
      : [],
    canObserve: checkObserverEligibility(facts, {
      observerId: actor.personId,
      subjectId: person.id,
      on,
    }).eligible,
    coachingDirections:
      person.status === 'active'
        ? proposableDirections(facts, {
            viewerId: actor.personId,
            otherId: person.id,
            on,
            live,
          })
        : [],
  };
});

/**
 * "How this was earned": the credits behind a badge, grouped by piece of work
 * through the one projection (`projectWork`), so work two observers saw counts
 * once and the receipt marks which credit counted. The total is set against
 * what the badge needed when it was awarded (its saved thresholds), never
 * today's policy. Narratives only where the viewer may read them (I13).
 */
export const buildBadgeReceipt = Effect.fn('people.badgeReceipt')(function* (
  personId: PersonId,
  badgeId: BadgeAwardId,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [badge] = yield* db
    .select()
    .from(schema.badgeAward)
    .where(
      and(
        eq(schema.badgeAward.tenantId, actor.tenantId),
        eq(schema.badgeAward.id, badgeId),
        eq(schema.badgeAward.personId, personId),
      ),
    );
  if (!badge) return yield* Effect.fail(new NotFound({ entity: 'badge', id: badgeId }));
  const skills = yield* loadSkills(actor.tenantId, [badge.skillId]);
  const skill = skills.get(badge.skillId);
  if (!skill) return yield* Effect.die('invariant: badge skill missing');
  const credits = yield* db
    .select({ credit: schema.creditEntry })
    .from(schema.badgeAwardCredit)
    .innerJoin(schema.creditEntry, eq(schema.creditEntry.id, schema.badgeAwardCredit.creditEntryId))
    .where(
      and(
        eq(schema.badgeAwardCredit.tenantId, actor.tenantId),
        eq(schema.badgeAwardCredit.badgeAwardId, badge.id),
      ),
    )
    .orderBy(schema.creditEntry.demonstratedOn)
    .pipe(Effect.map((rows) => rows.map((r) => r.credit)));
  const observations = credits.length
    ? yield* db
        .select({ id: schema.observation.id, narrativeSaw: schema.observation.narrativeSaw })
        .from(schema.observation)
        .where(
          and(
            eq(schema.observation.tenantId, actor.tenantId),
            inArray(
              schema.observation.id,
              credits.map((c) => c.observationId),
            ),
          ),
        )
    : [];
  const people = yield* loadPeople(actor.tenantId, [
    badge.personId,
    ...credits.map((c) => c.observerId),
  ]);
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const criteria = badge.criteria;
  const span = Math.round(
    (Date.parse(criteria.lastDemonstratedOn) - Date.parse(criteria.firstDemonstratedOn)) /
      86_400_000,
  );
  const readable = (observerId: PersonId) =>
    canReadNarrative(facts, {
      viewerId: actor.personId,
      subjectId: badge.personId,
      observerId,
      on,
    });
  const observers = new Set(credits.map((x) => x.observerId)).size;
  // Points through the one projection: each piece of work once, at its highest value.
  const work = projectWork(credits.map(toCreditFact));
  const firstHand = work.filter((w) => w.firstHand).length;
  const demonstrations = work.length;
  const points = work.reduce((sum, w) => sum + w.value, 0);
  const saved = criteriaFromSnapshot(criteria.thresholds);
  return {
    badge: {
      id: badge.id,
      skill: toSkillRef(skill),
      level: badge.level,
      levelName: LEVEL_NAMES[badge.level as Level],
      awardedAt: badge.awardedAt.toISOString(),
    },
    holder: personFrom(people, badge.personId),
    facts: `Observed ${demonstrations} ${demonstrations === 1 ? 'time' : 'times'} · ${points} points · ${observers} observers · ${firstHand} seen first-hand · over ${weeks(span)} weeks`,
    narrativesVisible: credits.some((c) => readable(c.observerId)),
    points,
    required: saved.ok
      ? {
          points: saved.criteria.badgePoints,
          interactions: saved.criteria.minInteractions,
          observers: saved.criteria.minObservers,
          firstHandShare: saved.criteria.minFirstHandShare,
          spanDays: saved.criteria.minSpanDays,
          primaryPoints: saved.criteria.minPrimaryPoints,
        }
      : null,
    work: work.map((w) => ({
      interactionId: w.interactionId,
      occurredOn: w.on,
      points: w.value,
      credits: w.creditIds.flatMap((creditId) => {
        const c = credits.find((x) => x.id === creditId);
        if (!c) return [];
        return [
          {
            id: c.observationId,
            observer: personFrom(people, c.observerId),
            level: c.level,
            levelName: LEVEL_NAMES[c.level as Level],
            mode: c.mode as ObservationMode,
            narrativeSaw: readable(c.observerId)
              ? (observations.find((o) => o.id === c.observationId)?.narrativeSaw ?? null)
              : null,
            points: c.points,
            role: c.role as CreditRole,
            pointsSource: c.pointsSource as PointsSource,
            counted: c.id === w.countedCreditId,
          },
        ];
      }),
    })),
  } satisfies BadgeReceiptView;
});
