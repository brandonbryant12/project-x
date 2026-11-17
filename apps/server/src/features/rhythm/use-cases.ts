import { CurrentActor, Forbidden, NotFound, Unprocessable } from '@repo/api';
import {
  CommitmentId,
  CommitmentLifecycle,
  ConversationId,
  ConversationLifecycle,
  screenLocally,
  type CommitmentEventType,
  type CommitmentStatus,
  type ConversationEventType,
  type ConversationStatus,
  type IsoDate,
  type ObservationId,
  type PersonId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDays, now, today } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { businessDateIn, tenantTimeZone } from '../shared/business-date.ts';
import { decide, requireUpdated } from '../shared/mutation.ts';
import { loadPeople } from '../shared/people.ts';
import { basisEdge, loadRelationshipFacts } from '../shared/relationships.ts';
import {
  canSeeCommitment,
  commitmentPolicy,
  conversationFacts,
  conversationHosting,
  conversationPolicy,
  isConversationParty,
  type ConversationRow,
} from '../shared/rhythm.ts';

/** "We just met": a conversation may be logged up to this long after it started. */
const SCHEDULE_PAST_GRACE_HOURS = 12;
const SCHEDULE_HORIZON_DAYS = 365;
const CREDITED_STATES = ['signed', 'under_review'] as const;

/** A conversation is visible only to its two parties; anyone else gets NotFound. */
export const loadConversation = Effect.fn('conversations.load')(function* (id: ConversationId) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.coachingConversation)
    .where(
      and(
        eq(schema.coachingConversation.tenantId, actor.tenantId),
        eq(schema.coachingConversation.id, id),
      ),
    );
  if (!row || !isConversationParty(actor.personId, row)) {
    return yield* Effect.fail(new NotFound({ entity: 'conversation', id }));
  }
  return row;
});

export const loadCommitment = Effect.fn('commitments.load')(function* (id: CommitmentId) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.commitment)
    .where(and(eq(schema.commitment.tenantId, actor.tenantId), eq(schema.commitment.id, id)));
  const facts = row ? yield* loadRelationshipFacts(actor.tenantId) : null;
  if (!row || !facts || !canSeeCommitment(facts, actor.personId, row, yield* today)) {
    return yield* Effect.fail(new NotFound({ entity: 'commitment', id }));
  }
  return row;
});

const parseInstant = (value: string) =>
  Effect.gen(function* () {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) {
      return yield* Effect.fail(
        new Unprocessable({ message: 'That is not a valid time.', field: 'scheduledFor' }),
      );
    }
    const current = yield* now;
    if (at.getTime() < addDays(current, -SCHEDULE_PAST_GRACE_HOURS / 24).getTime()) {
      return yield* Effect.fail(
        new Unprocessable({ message: 'That time has already passed.', field: 'scheduledFor' }),
      );
    }
    if (at.getTime() > addDays(current, SCHEDULE_HORIZON_DAYS).getTime()) {
      return yield* Effect.fail(
        new Unprocessable({
          message: 'Schedule conversations within the next year.',
          field: 'scheduledFor',
        }),
      );
    }
    return at;
  });

/** The relationship edge the conversation rests on, as of its business date. */
const edgeFor = Effect.fn('conversations.edge')(function* (
  hosting: { readonly hostId: PersonId; readonly coacheeId: PersonId; readonly basis: string },
  on: IsoDate,
) {
  const actor = yield* CurrentActor;
  const edge = yield* basisEdge(actor.tenantId, {
    observerId: hosting.hostId,
    subjectId: hosting.coacheeId,
    on,
    basis: hosting.basis === 'leader' ? 'leader' : 'coach',
  });
  return hosting.basis === 'leader'
    ? { basisReportingLineId: edge.basisReportingLineId, basisEngagementId: null }
    : { basisReportingLineId: null, basisEngagementId: edge.basisEngagementId };
});

/** A new time for a conversation, still covered by the relationship it rests on. */
const rescheduleTo = Effect.fn('conversations.rescheduleTo')(function* (
  row: ConversationRow,
  value: string | undefined,
  timeZone: string,
) {
  if (!value) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Choose a new time.', field: 'scheduledFor' }),
    );
  }
  const scheduledFor = yield* parseInstant(value);
  const edge = yield* edgeFor(row, businessDateIn(scheduledFor, timeZone));
  if (!edge.basisEngagementId && !edge.basisReportingLineId) {
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Your coaching or reporting relationship does not cover that date.',
        field: 'scheduledFor',
      }),
    );
  }
  return { scheduledFor, ...edge };
});

/**
 * Either party schedules. The server decides who hosts and on which basis, as
 * of the scheduled date: a leader's 1:1 or an engaged coach's session.
 */
export const scheduleConversation = Effect.fn('useCase.scheduleConversation')(function* (input: {
  readonly withPersonId: PersonId;
  readonly scheduledFor: string;
}) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const scheduledFor = yield* parseInstant(input.scheduledFor);
  const other = yield* loadPeople(actor.tenantId, [input.withPersonId]);
  if (!other.has(input.withPersonId)) {
    return yield* Effect.fail(new NotFound({ entity: 'person', id: input.withPersonId }));
  }
  const on = businessDateIn(scheduledFor, yield* tenantTimeZone(actor.tenantId));
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const hosting = conversationHosting(facts, actor.personId, input.withPersonId, on);
  const edge = hosting ? yield* edgeFor(hosting, on) : null;
  if (!hosting || !edge || (!edge.basisEngagementId && !edge.basisReportingLineId)) {
    return yield* Effect.fail(
      new Forbidden({
        message:
          'You can schedule conversations with your reports, your coachees, your leader and your coaches.',
      }),
    );
  }
  const id = ConversationId.generate();
  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.coachingConversation).values({
        id,
        tenantId: actor.tenantId,
        coacheeId: hosting.coacheeId,
        hostId: hosting.hostId,
        basis: hosting.basis,
        ...edge,
        createdById: actor.personId,
        status: 'scheduled',
        scheduledFor,
      });
      yield* recordAudit(actor, {
        entityType: 'conversation',
        entityId: id,
        event: 'SCHEDULE',
        to: 'scheduled',
        data: { basis: hosting.basis, scheduledFor: scheduledFor.toISOString() },
      });
    }),
  );
  return id;
});

export const conversationEvent = Effect.fn('useCase.conversationEvent')(function* (
  id: ConversationId,
  input: {
    readonly event: ConversationEventType;
    readonly version: number;
    readonly scheduledFor?: string | undefined;
  },
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const row: ConversationRow = yield* loadConversation(id);
  const at = yield* now;
  const from = row.status as ConversationStatus;
  const to = yield* decide({
    lifecycle: ConversationLifecycle,
    from,
    facts: conversationFacts(row, at),
    event: { type: input.event },
    permitted: conversationPolicy(actor, row)[input.event],
    ...((input.event === 'HOLD' || input.event === 'MISS') &&
      from === 'scheduled' && {
        explain: 'This conversation has not started yet. Reschedule or cancel it instead.',
      }),
  });
  const timeZone = yield* tenantTimeZone(actor.tenantId);
  const rescheduled =
    input.event === 'RESCHEDULE' ? yield* rescheduleTo(row, input.scheduledFor, timeZone) : null;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.coachingConversation)
        .set({
          status: to,
          version: input.version + 1,
          updatedAt: at,
          ...(input.event === 'HOLD' && { heldOn: businessDateIn(row.scheduledFor, timeZone) }),
          ...(ConversationLifecycle.isTerminal(to) && { closedAt: at }),
          ...rescheduled,
        })
        .where(
          and(
            eq(schema.coachingConversation.id, row.id),
            eq(schema.coachingConversation.version, input.version),
          ),
        )
        .returning({ id: schema.coachingConversation.id })
        .pipe(Effect.flatMap(requireUpdated('conversation')));
      yield* recordAudit(actor, {
        entityType: 'conversation',
        entityId: row.id,
        event: input.event,
        from,
        to,
        ...(rescheduled && {
          data: {
            from: row.scheduledFor.toISOString(),
            to: rescheduled.scheduledFor.toISOString(),
          },
        }),
      });
    }),
  );
});

/**
 * The coachee owns a commitment. They may create it, and so may the people
 * supporting them: their leader, an engaged coach, or anyone who has signed an
 * observation about them. The text passes the local privacy screen; held text
 * is refused, never stored. A commitment never touches credit.
 */
export const createCommitment = Effect.fn('useCase.createCommitment')(function* (input: {
  readonly ownerId: PersonId;
  readonly body: string;
  readonly dueOn: IsoDate | null;
  readonly conversationId: ConversationId | null;
  readonly sourceObservationId: ObservationId | null;
}) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const on = yield* today;
  const owner = yield* loadPeople(actor.tenantId, [input.ownerId]);
  if (!owner.has(input.ownerId)) {
    return yield* Effect.fail(new NotFound({ entity: 'person', id: input.ownerId }));
  }
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const supports =
    actor.personId === input.ownerId ||
    canSeeCommitment(
      facts,
      actor.personId,
      { ownerId: input.ownerId, createdById: input.ownerId },
      on,
    ) ||
    (yield* db
      .select({ id: schema.observation.id })
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.tenantId, actor.tenantId),
          eq(schema.observation.observerId, actor.personId),
          eq(schema.observation.subjectId, input.ownerId),
          inArray(schema.observation.status, [...CREDITED_STATES]),
        ),
      )
      .limit(1)).length > 0;
  if (!supports) {
    return yield* Effect.fail(
      new Forbidden({ message: 'You can add commitments only for people you support.' }),
    );
  }
  if (input.sourceObservationId) {
    const [source] = yield* db
      .select()
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.tenantId, actor.tenantId),
          eq(schema.observation.id, input.sourceObservationId),
        ),
      );
    if (!source || (source.observerId !== actor.personId && source.subjectId !== actor.personId)) {
      return yield* Effect.fail(
        new NotFound({ entity: 'observation', id: input.sourceObservationId }),
      );
    }
    if (source.subjectId !== input.ownerId) {
      return yield* Effect.fail(
        new Unprocessable({
          message: 'A commitment from an observation belongs to the person observed.',
          field: 'ownerId',
        }),
      );
    }
    if (!(CREDITED_STATES as ReadonlyArray<string>).includes(source.status)) {
      return yield* Effect.fail(
        new Unprocessable({
          message: 'Only a signed observation has a next step to commit to.',
          field: 'sourceObservationId',
        }),
      );
    }
  }
  if (input.conversationId) {
    const conversation = yield* loadConversation(input.conversationId);
    if (conversation.coacheeId !== input.ownerId) {
      return yield* Effect.fail(
        new Unprocessable({
          message: 'A commitment from a conversation belongs to its coachee.',
          field: 'ownerId',
        }),
      );
    }
  }
  if (input.dueOn !== null && input.dueOn < on) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Choose a due date from today on.', field: 'dueOn' }),
    );
  }
  const body = input.body.trim();
  if (body.length < 3) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Say what will be done.', field: 'body' }),
    );
  }
  const screen = screenLocally(body);
  if (screen.held) {
    return yield* Effect.fail(
      new Unprocessable({
        message: `Rewrite this without client details. ${screen.reasons.join('. ')}.`,
        field: 'body',
      }),
    );
  }
  const id = CommitmentId.generate();
  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.commitment).values({
        id,
        tenantId: actor.tenantId,
        ownerId: input.ownerId,
        createdById: actor.personId,
        body,
        sourceObservationId: input.sourceObservationId,
        conversationId: input.conversationId,
        dueOn: input.dueOn,
        status: 'open',
      });
      yield* recordAudit(actor, {
        entityType: 'commitment',
        entityId: id,
        event: 'CREATE',
        to: 'open',
        data: {
          ownerId: input.ownerId,
          ...(input.sourceObservationId && { sourceObservationId: input.sourceObservationId }),
          ...(input.conversationId && { conversationId: input.conversationId }),
        },
      });
    }),
  );
  return id;
});

export const commitmentEvent = Effect.fn('useCase.commitmentEvent')(function* (
  id: CommitmentId,
  event: CommitmentEventType,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const row = yield* loadCommitment(id);
  const from = row.status as CommitmentStatus;
  const to = yield* decide({
    lifecycle: CommitmentLifecycle,
    from,
    facts: {},
    event: { type: event },
    permitted: commitmentPolicy(actor, row)[event],
    forbiddenMessage: 'Only the person who owns this commitment, or who wrote it, can change it.',
  });
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.commitment)
        .set({
          status: to,
          version: row.version + 1,
          updatedAt: at,
          closedAt: to === 'open' ? null : at,
        })
        .where(and(eq(schema.commitment.id, row.id), eq(schema.commitment.version, row.version)))
        .returning({ id: schema.commitment.id })
        .pipe(Effect.flatMap(requireUpdated('commitment')));
      yield* recordAudit(actor, { entityType: 'commitment', entityId: row.id, event, from, to });
    }),
  );
});
