import type { Actor, CoachingView, EngagementView, SupportRow } from '@repo/api';
import {
  EngagementLifecycle,
  coacheesOf,
  directReportsOf,
  hasCoachGrantOn,
  type EngagementEventType,
  type EngagementStatus,
  type IsoDate,
  type PersonId,
  type PlanStatus,
  type RelationshipFacts,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDaysIso, today } from '../../platform/time.ts';
import { loadPlanSkills } from '../shared/catalog-reads.ts';
import { loadPeople, personFrom } from '../shared/people.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import { loadSkills, refsFor, toSkillRef } from '../shared/skills.ts';
import { planAgreers } from '../shared/plans.ts';

const RECENT_DAYS = 42;

/**
 * Coverage rows for people the viewer supports. Coverage and momentum only —
 * never totals, ranks or sortable progress (docs/product/ux-brief.md § My Team).
 */
export const supportRows = Effect.fn('support.rows')(function* (
  actor: Actor,
  personIds: ReadonlyArray<PersonId>,
  facts: RelationshipFacts,
  on: IsoDate,
) {
  if (personIds.length === 0) return [] as Array<SupportRow>;
  const db = yield* Db;
  const [plans, waiting, credits] = yield* Effect.all([
    db
      .select()
      .from(schema.plan)
      .where(
        and(
          eq(schema.plan.tenantId, actor.tenantId),
          inArray(schema.plan.ownerId, [...personIds]),
          inArray(schema.plan.status, ['draft', 'proposed', 'active', 'paused']),
        ),
      ),
    db
      .select({ subjectId: schema.observation.subjectId })
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.tenantId, actor.tenantId),
          eq(schema.observation.observerId, actor.personId),
          inArray(schema.observation.subjectId, [...personIds]),
          inArray(schema.observation.status, ['requested', 'drafting']),
        ),
      ),
    // Credit that stands: a voided observation's credit is reversed and no longer counts.
    db
      .select({
        personId: schema.creditEntry.personId,
        skillId: schema.creditEntry.skillId,
        observerId: schema.creditEntry.observerId,
        demonstratedOn: schema.creditEntry.demonstratedOn,
      })
      .from(schema.creditEntry)
      .leftJoin(
        schema.creditReversal,
        and(
          eq(schema.creditReversal.tenantId, schema.creditEntry.tenantId),
          eq(schema.creditReversal.creditEntryId, schema.creditEntry.id),
        ),
      )
      .where(
        and(
          eq(schema.creditEntry.tenantId, actor.tenantId),
          inArray(schema.creditEntry.personId, [...personIds]),
          isNull(schema.creditReversal.id),
        ),
      )
      .orderBy(desc(schema.creditEntry.demonstratedOn)),
  ]);
  const focus = yield* loadPlanSkills(
    actor.tenantId,
    plans.map((p) => p.id),
  );
  const skills = yield* loadSkills(
    actor.tenantId,
    [...focus.values()].flat().map((f) => f.skillId),
  );
  const people = yield* loadPeople(actor.tenantId, [
    ...personIds,
    ...credits.map((c) => c.observerId),
  ]);
  const recentFrom = addDaysIso(on, -RECENT_DAYS);
  return personIds
    .map((personId): SupportRow => {
      const plan = plans.find((p) => p.ownerId === personId);
      const planSkills = plan ? (focus.get(plan.id) ?? []) : [];
      const theirs = credits.filter((c) => c.personId === personId);
      const agreeWaiting =
        plan?.status === 'proposed' && planAgreers(facts, personId, on).includes(actor.personId)
          ? 1
          : 0;
      return {
        person: personFrom(people, personId),
        plan: plan
          ? {
              id: plan.id,
              status: plan.status as PlanStatus,
              focusSkills: refsFor(
                skills,
                planSkills.map((f) => f.skillId),
              ),
            }
          : null,
        waitingOnYou: waiting.filter((w) => w.subjectId === personId).length + agreeWaiting,
        lastObservedOn: theirs[0]?.demonstratedOn ?? null,
        coverage: planSkills.flatMap((f) => {
          const skill = skills.get(f.skillId);
          if (!skill) return [];
          const last = theirs.find((c) => c.skillId === f.skillId);
          return [
            {
              skill: toSkillRef(skill),
              observedRecently: last !== undefined && last.demonstratedOn >= recentFrom,
              lastObservedOn: last?.demonstratedOn ?? null,
              lastObserver: last ? personFrom(people, last.observerId).displayName : null,
            },
          ];
        }),
      };
    })
    .toSorted((a, b) => a.person.displayName.localeCompare(b.person.displayName));
});

export const buildTeam = Effect.fn('support.team')(function* (actor: Actor) {
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const rows = yield* supportRows(actor, directReportsOf(facts, actor.personId, on), facts, on);
  const recentFrom = addDaysIso(on, -RECENT_DAYS);
  return {
    rows,
    waitingOnYou: rows.reduce((n, r) => n + r.waitingOnYou, 0),
    unobservedCount: rows.filter((r) => r.lastObservedOn === null || r.lastObservedOn < recentFrom)
      .length,
  };
});

/** Who may send each engagement event (policy). The lifecycle decides which apply now. */
export const engagementPolicy = (
  actor: Actor,
  row: typeof schema.engagement.$inferSelect,
): Record<EngagementEventType, boolean> => {
  const isParty = row.coachId === actor.personId || row.coacheeId === actor.personId;
  const isProposer = row.proposedById === actor.personId;
  return {
    ACCEPT: isParty && !isProposer,
    DECLINE: isParty && !isProposer,
    WITHDRAW: isProposer,
    PAUSE: isParty,
    RESUME: isParty,
    END: isParty,
    EXPIRE: false,
  };
};

export const engagementActions = (
  actor: Actor,
  row: typeof schema.engagement.$inferSelect,
  coachGrantActive: boolean,
): ReadonlyArray<EngagementEventType> => {
  const permitted = engagementPolicy(actor, row);
  return EngagementLifecycle.allowed(
    row.status as EngagementStatus,
    { coachGrantActive },
    EngagementLifecycle.events.filter((e) => permitted[e]).map((type) => ({ type })),
  );
};

export const buildEngagementViews = Effect.fn('support.engagements')(function* (
  actor: Actor,
  rows: ReadonlyArray<typeof schema.engagement.$inferSelect>,
) {
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const people = yield* loadPeople(
    actor.tenantId,
    rows.flatMap((r) => [r.coachId, r.coacheeId, r.proposedById]),
  );
  const coacheeRows = yield* supportRows(
    actor,
    rows
      .filter((r) => r.coachId === actor.personId && r.status !== 'proposed')
      .map((r) => r.coacheeId),
    facts,
    on,
  );
  return rows.map((r): EngagementView => ({
    id: r.id,
    status: r.status as EngagementStatus,
    coach: personFrom(people, r.coachId),
    coachee: personFrom(people, r.coacheeId),
    proposedBy: personFrom(people, r.proposedById),
    note: r.note,
    acceptedOn: r.acceptedOn,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    actions: engagementActions(actor, r, hasCoachGrantOn(facts, r.coachId, on)),
    row: coacheeRows.find((row) => row.person.id === r.coacheeId) ?? null,
  }));
});

export const buildCoaching = Effect.fn('support.coaching')(function* (actor: Actor) {
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.engagement)
    .where(
      and(
        eq(schema.engagement.tenantId, actor.tenantId),
        or(
          eq(schema.engagement.coachId, actor.personId),
          eq(schema.engagement.coacheeId, actor.personId),
        ),
        inArray(schema.engagement.status, ['proposed', 'active', 'paused']),
      ),
    );
  const views = yield* buildEngagementViews(actor, rows);
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  return {
    asCoach: views.filter((v) => v.coach.id === actor.personId),
    asCoachee: views.filter((v) => v.coachee.id === actor.personId),
    isCoach:
      hasCoachGrantOn(facts, actor.personId, yield* today) ||
      coacheesOf(facts, actor.personId, yield* today).length > 0,
  } satisfies CoachingView;
});
