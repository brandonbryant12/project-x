import type { Actor, ConversationsView, ConversationView } from '@repo/api';
import {
  canViewDevelopment,
  coacheesOf,
  coachesOf,
  directReportsOf,
  leaderOf,
  type ConversationBasis,
  type InteractionKind,
  type IsoDate,
  type PersonId,
  type RelationshipFacts,
  type SkillId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte, ne, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDays, addDaysIso, now, today } from '../../platform/time.ts';
import { nextStepOf } from '../shared/next-step.ts';
import { loadPeople, personFrom } from '../shared/people.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import {
  buildCommitmentViews,
  buildConversationSummaries,
  canSeeCommitment,
  conversationActions,
  openCommitmentsOf,
  type ConversationRow,
} from '../shared/rhythm.ts';
import { loadSkills, refsFor } from '../shared/skills.ts';

/** Without a previous held conversation, the agenda looks back this far. */
const FIRST_AGENDA_LOOKBACK_DAYS = 42;
/** `GET /conversations` lists closed conversations from this many days back. */
const RECENT_CONVERSATION_DAYS = 56;
/** `GET /people/:id/commitments` lists closed commitments from this many days back. */
const RECENT_COMMITMENT_DAYS = 28;
const AGENDA_INTERACTION_LIMIT = 10;
const CREDITED_STATES = ['signed', 'under_review'] as const;

/**
 * The agenda is assembled, never stored (ADR 0019). It covers the time since the
 * previous held conversation between the same two people. Observations and
 * interactions appear only when the viewer may see the coachee's development,
 * and never with narrative text.
 */
const assembleAgenda = Effect.fn('rhythm.agenda')(function* (actor: Actor, row: ConversationRow) {
  const db = yield* Db;
  const at = yield* now;
  const on = yield* today;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const [previous] = yield* db
    .select()
    .from(schema.coachingConversation)
    .where(
      and(
        eq(schema.coachingConversation.tenantId, actor.tenantId),
        eq(schema.coachingConversation.coacheeId, row.coacheeId),
        eq(schema.coachingConversation.hostId, row.hostId),
        eq(schema.coachingConversation.status, 'held'),
        ne(schema.coachingConversation.id, row.id),
        lte(schema.coachingConversation.scheduledFor, row.scheduledFor),
      ),
    )
    .orderBy(desc(schema.coachingConversation.scheduledFor))
    .limit(1);
  const since = previous?.heldOn ?? null;
  const signedAfter = previous?.closedAt ?? addDays(at, -FIRST_AGENDA_LOOKBACK_DAYS);
  const occurredFrom = since ?? addDaysIso(on, -FIRST_AGENDA_LOOKBACK_DAYS);
  // A held conversation's agenda stops where the conversation did.
  const signedUntil = row.status === 'held' ? row.closedAt : null;
  const occurredUntil = row.status === 'held' ? row.heldOn : null;

  const commitments = yield* buildCommitmentViews(
    actor,
    yield* openCommitmentsOf(actor.tenantId, [row.coacheeId]),
  );
  const seesDevelopment = canViewDevelopment(facts, {
    viewerId: actor.personId,
    subjectId: row.coacheeId,
    on,
  });
  if (!seesDevelopment) {
    return {
      since,
      signedObservations: [],
      unobservedInteractions: [],
      commitments,
      nextStep: null,
    } satisfies ConversationView['agenda'];
  }

  const signed = yield* db
    .select({
      id: schema.observation.id,
      observerId: schema.observation.observerId,
      occurredOn: schema.interaction.occurredOn,
    })
    .from(schema.observation)
    .innerJoin(schema.interaction, eq(schema.interaction.id, schema.observation.interactionId))
    .where(
      and(
        eq(schema.observation.tenantId, actor.tenantId),
        eq(schema.observation.subjectId, row.coacheeId),
        inArray(schema.observation.status, [...CREDITED_STATES]),
        gt(schema.observation.signedAt, signedAfter),
        signedUntil ? lte(schema.observation.signedAt, signedUntil) : undefined,
      ),
    )
    .orderBy(asc(schema.observation.signedAt));
  const ratings = signed.length
    ? yield* db
        .select({
          observationId: schema.observationRating.observationId,
          skillId: schema.observationRating.skillId,
        })
        .from(schema.observationRating)
        .where(
          and(
            inArray(
              schema.observationRating.observationId,
              signed.map((o) => o.id),
            ),
            isNotNull(schema.observationRating.level),
          ),
        )
        .orderBy(asc(schema.observationRating.position))
    : [];

  const interactions = yield* db
    .select({
      id: schema.interaction.id,
      occurredOn: schema.interaction.occurredOn,
      kind: schema.interaction.kind,
      title: schema.activity.title,
    })
    .from(schema.interaction)
    .innerJoin(schema.activity, eq(schema.activity.id, schema.interaction.activityId))
    .where(
      and(
        eq(schema.interaction.tenantId, actor.tenantId),
        eq(schema.interaction.ownerId, row.coacheeId),
        gte(schema.interaction.occurredOn, occurredFrom),
        occurredUntil ? lte(schema.interaction.occurredOn, occurredUntil) : undefined,
      ),
    )
    .orderBy(desc(schema.interaction.occurredOn));
  const observed = interactions.length
    ? yield* db
        .select({ interactionId: schema.observation.interactionId })
        .from(schema.observation)
        .where(
          and(
            inArray(
              schema.observation.interactionId,
              interactions.map((i) => i.id),
            ),
            inArray(schema.observation.status, [...CREDITED_STATES]),
          ),
        )
    : [];
  const observedIds = new Set(observed.map((o) => o.interactionId));

  const skills = yield* loadSkills(
    actor.tenantId,
    ratings.map((r) => r.skillId),
  );
  const people = yield* loadPeople(
    actor.tenantId,
    signed.map((o) => o.observerId),
  );
  return {
    since,
    signedObservations: signed.map((o) => ({
      id: o.id,
      observer: personFrom(people, o.observerId),
      occurredOn: o.occurredOn,
      skills: refsFor(
        skills,
        ratings.filter((r) => r.observationId === o.id).map((r) => r.skillId as SkillId),
      ),
      href: `/observations/${o.id}`,
    })),
    unobservedInteractions: interactions
      .filter((i) => !observedIds.has(i.id))
      .slice(0, AGENDA_INTERACTION_LIMIT)
      .map((i) => ({
        id: i.id,
        occurredOn: i.occurredOn,
        kind: i.kind as InteractionKind,
        title: i.title,
      })),
    commitments,
    nextStep: yield* nextStepOf(actor.tenantId, row.coacheeId),
  } satisfies ConversationView['agenda'];
});

export const buildConversationView = Effect.fn('rhythm.conversationView')(function* (
  actor: Actor,
  row: ConversationRow,
) {
  const [summary] = yield* buildConversationSummaries(actor, [row]);
  if (!summary) return yield* Effect.die('invariant: conversation view for a non-party');
  return {
    ...summary,
    agenda: yield* assembleAgenda(actor, row),
    actions: conversationActions(actor, row, yield* now),
    version: row.version,
  } satisfies ConversationView;
});

/** Everyone the viewer could schedule with today, and whether the viewer would host. */
const partnersOf = (facts: RelationshipFacts, me: PersonId, on: IsoDate) => {
  const partners = new Map<PersonId, { basis: ConversationBasis; asHost: boolean }>();
  const add = (id: PersonId, basis: ConversationBasis, asHost: boolean) => {
    if (id !== me && !partners.has(id)) partners.set(id, { basis, asHost });
  };
  // Leader edges first: a leader's basis wins when both apply.
  for (const id of directReportsOf(facts, me, on)) add(id, 'leader', true);
  const leader = leaderOf(facts, me, on);
  if (leader) add(leader, 'leader', false);
  for (const id of coacheesOf(facts, me, on))
    if (coachesOf(facts, id, on).includes(me)) add(id, 'coach', true);
  for (const id of coachesOf(facts, me, on)) add(id, 'coach', false);
  return partners;
};

export const buildConversations = Effect.fn('rhythm.conversations')(function* (actor: Actor) {
  const db = yield* Db;
  const at = yield* now;
  const on = yield* today;
  const party = or(
    eq(schema.coachingConversation.hostId, actor.personId),
    eq(schema.coachingConversation.coacheeId, actor.personId),
  );
  const [upcoming, recent] = yield* Effect.all([
    db
      .select()
      .from(schema.coachingConversation)
      .where(
        and(
          eq(schema.coachingConversation.tenantId, actor.tenantId),
          party,
          eq(schema.coachingConversation.status, 'scheduled'),
        ),
      )
      .orderBy(asc(schema.coachingConversation.scheduledFor)),
    db
      .select()
      .from(schema.coachingConversation)
      .where(
        and(
          eq(schema.coachingConversation.tenantId, actor.tenantId),
          party,
          ne(schema.coachingConversation.status, 'scheduled'),
          gte(schema.coachingConversation.scheduledFor, addDays(at, -RECENT_CONVERSATION_DAYS)),
        ),
      )
      .orderBy(desc(schema.coachingConversation.scheduledFor)),
  ]);
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const partners = partnersOf(facts, actor.personId, on);
  const people = yield* loadPeople(actor.tenantId, [...partners.keys()]);
  return {
    upcoming: yield* buildConversationSummaries(actor, upcoming),
    recent: yield* buildConversationSummaries(actor, recent),
    partners: [...partners.entries()]
      .map(([id, p]) => ({ person: personFrom(people, id), ...p }))
      .toSorted((a, b) => a.person.displayName.localeCompare(b.person.displayName)),
  } satisfies ConversationsView;
});

/**
 * A person's commitments: open first (soonest due), then those closed in the
 * last four weeks. NotFound unless the viewer may see the person's commitments
 * (self, direct leader, engaged coach) or created one of them.
 */
export const buildPersonCommitments = Effect.fn('rhythm.personCommitments')(function* (
  actor: Actor,
  personId: PersonId,
) {
  const db = yield* Db;
  const at = yield* now;
  const on = yield* today;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const open = yield* openCommitmentsOf(actor.tenantId, [personId]);
  const closed = yield* db
    .select()
    .from(schema.commitment)
    .where(
      and(
        eq(schema.commitment.tenantId, actor.tenantId),
        eq(schema.commitment.ownerId, personId),
        ne(schema.commitment.status, 'open'),
        gte(schema.commitment.closedAt, addDays(at, -RECENT_COMMITMENT_DAYS)),
      ),
    )
    .orderBy(desc(schema.commitment.closedAt));
  const supportsPerson = canSeeCommitment(
    facts,
    actor.personId,
    { ownerId: personId, createdById: personId },
    on,
  );
  const views = yield* buildCommitmentViews(actor, [...open, ...closed]);
  return { visible: supportsPerson || views.length > 0, views };
});
