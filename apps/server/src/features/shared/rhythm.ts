import type { Actor, CommitmentView, ConversationSummary } from '@repo/api';
import {
  CommitmentLifecycle,
  ConversationLifecycle,
  coachesOf,
  leaderOf,
  type CommitmentEventType,
  type CommitmentStatus,
  type ConversationBasis,
  type ConversationEventType,
  type ConversationStatus,
  type IsoDate,
  type PersonId,
  type RelationshipFacts,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { today } from '../../platform/time.ts';
import { loadPeople, personFrom } from './people.ts';
import { loadRelationshipFacts } from './relationships.ts';

/**
 * The weekly rhythm (ADR 0019), shared by the rhythm feature and Home:
 * conversation and commitment policy, summaries and the two reads Home needs.
 * Neither a conversation nor a commitment ever touches credit.
 */
export type ConversationRow = typeof schema.coachingConversation.$inferSelect;
export type CommitmentRow = typeof schema.commitment.$inferSelect;

/* ---------- Conversations ---------- */

/** A conversation is visible only to its two parties. */
export const isConversationParty = (personId: PersonId, row: ConversationRow): boolean =>
  row.hostId === personId || row.coacheeId === personId;

/** Who may send each conversation event: either party. The lifecycle decides which apply now. */
export const conversationPolicy = (
  actor: Actor,
  row: ConversationRow,
): Record<ConversationEventType, boolean> => {
  const party = isConversationParty(actor.personId, row);
  return { HOLD: party, MISS: party, CANCEL: party, RESCHEDULE: party };
};

/** HOLD and MISS only once the scheduled time has arrived. */
export const conversationFacts = (row: ConversationRow, at: Date) => ({
  started: row.scheduledFor.getTime() <= at.getTime(),
});

export const conversationActions = (
  actor: Actor,
  row: ConversationRow,
  at: Date,
): ReadonlyArray<ConversationEventType> => {
  const permitted = conversationPolicy(actor, row);
  return ConversationLifecycle.allowed(
    row.status as ConversationStatus,
    conversationFacts(row, at),
    ConversationLifecycle.events.filter((e) => permitted[e]).map((type) => ({ type })),
  );
};

/**
 * Who hosts a conversation between `actorId` and `otherId` on `on`, and on which
 * basis. A leader's basis wins over a coach's when both apply. Null when neither
 * leads or coaches the other.
 */
export const conversationHosting = (
  facts: RelationshipFacts,
  actorId: PersonId,
  otherId: PersonId,
  on: IsoDate,
): {
  readonly hostId: PersonId;
  readonly coacheeId: PersonId;
  readonly basis: ConversationBasis;
} | null => {
  if (actorId === otherId) return null;
  if (leaderOf(facts, otherId, on) === actorId)
    return { hostId: actorId, coacheeId: otherId, basis: 'leader' };
  if (leaderOf(facts, actorId, on) === otherId)
    return { hostId: otherId, coacheeId: actorId, basis: 'leader' };
  if (coachesOf(facts, otherId, on).includes(actorId))
    return { hostId: actorId, coacheeId: otherId, basis: 'coach' };
  if (coachesOf(facts, actorId, on).includes(otherId))
    return { hostId: otherId, coacheeId: actorId, basis: 'coach' };
  return null;
};

/* ---------- Commitments ---------- */

/**
 * Who may read a commitment on `on`: its owner, its creator, the owner's direct
 * leader and the owner's engaged coaches.
 */
export const canSeeCommitment = (
  facts: RelationshipFacts,
  viewerId: PersonId,
  row: Pick<CommitmentRow, 'ownerId' | 'createdById'>,
  on: IsoDate,
): boolean =>
  viewerId === row.ownerId ||
  viewerId === row.createdById ||
  leaderOf(facts, row.ownerId, on) === viewerId ||
  coachesOf(facts, row.ownerId, on).includes(viewerId);

/** The owner or the creator may complete, drop or reopen a commitment. */
export const commitmentPolicy = (
  actor: Actor,
  row: CommitmentRow,
): Record<CommitmentEventType, boolean> => {
  const may = actor.personId === row.ownerId || actor.personId === row.createdById;
  return { COMPLETE: may, DROP: may, REOPEN: may };
};

const commitmentActions = (actor: Actor, row: CommitmentRow) => {
  const permitted = commitmentPolicy(actor, row);
  return CommitmentLifecycle.allowed(
    row.status as CommitmentStatus,
    {},
    CommitmentLifecycle.events.filter((e) => permitted[e]).map((type) => ({ type })),
  );
};

/** Commitment views for the rows the viewer may see (others are dropped), in input order. */
export const buildCommitmentViews = Effect.fn('rhythm.commitmentViews')(function* (
  actor: Actor,
  rows: ReadonlyArray<CommitmentRow>,
) {
  if (rows.length === 0) return [] as Array<CommitmentView>;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const visible = rows.filter((r) => canSeeCommitment(facts, actor.personId, r, on));
  const people = yield* loadPeople(
    actor.tenantId,
    visible.flatMap((r) => [r.ownerId, r.createdById]),
  );
  return visible.map((r): CommitmentView => ({
    id: r.id,
    owner: personFrom(people, r.ownerId),
    createdBy: personFrom(people, r.createdById),
    body: r.body ?? '',
    dueOn: r.dueOn,
    status: r.status as CommitmentStatus,
    sourceObservationId: r.sourceObservationId,
    conversationId: r.conversationId,
    createdAt: r.createdAt.toISOString(),
    actions: commitmentActions(actor, r),
  }));
});

/** Open commitments of these people, soonest due first (undated last). Unfiltered by viewer. */
export const openCommitmentsOf = Effect.fn('rhythm.openCommitments')(function* (
  tenantId: TenantId,
  personIds: ReadonlyArray<PersonId>,
) {
  if (personIds.length === 0) return [] as Array<CommitmentRow>;
  const db = yield* Db;
  return yield* db
    .select()
    .from(schema.commitment)
    .where(
      and(
        eq(schema.commitment.tenantId, tenantId),
        inArray(schema.commitment.ownerId, [...new Set(personIds)]),
        eq(schema.commitment.status, 'open'),
      ),
    )
    .orderBy(
      sql`${schema.commitment.dueOn} asc nulls last`,
      asc(schema.commitment.createdAt),
      asc(schema.commitment.id),
    );
});

/* ---------- Summaries ---------- */

/**
 * Conversation summaries for the rows the viewer is a party to (others are
 * dropped), in input order. `openCommitments` counts the coachee's open
 * commitments the viewer may see.
 */
export const buildConversationSummaries = Effect.fn('rhythm.conversationSummaries')(function* (
  actor: Actor,
  rows: ReadonlyArray<ConversationRow>,
) {
  const mine = rows.filter((r) => isConversationParty(actor.personId, r));
  if (mine.length === 0) return [] as Array<ConversationSummary>;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const people = yield* loadPeople(
    actor.tenantId,
    mine.flatMap((r) => [r.hostId, r.coacheeId]),
  );
  const open = (yield* openCommitmentsOf(
    actor.tenantId,
    mine.map((r) => r.coacheeId),
  )).filter((c) => canSeeCommitment(facts, actor.personId, c, on));
  return mine.map((r): ConversationSummary => ({
    id: r.id,
    status: r.status as ConversationStatus,
    basis: r.basis as ConversationBasis,
    host: personFrom(people, r.hostId),
    coachee: personFrom(people, r.coacheeId),
    scheduledFor: r.scheduledFor.toISOString(),
    heldOn: r.heldOn,
    openCommitments: open.filter((c) => c.ownerId === r.coacheeId).length,
    href: `/conversations/${r.id}`,
  }));
});
