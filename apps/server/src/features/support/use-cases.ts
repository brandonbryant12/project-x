import { Conflict, CurrentActor, Forbidden, NotFound, Unprocessable } from '@repo/api';
import {
  ENGAGEMENT_PROPOSAL_DAYS,
  EngagementId,
  EngagementLifecycle,
  hasCoachGrantOn,
  type EngagementStatus,
  type PersonId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDays, now, today } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { notify } from '../shared/notify.ts';
import { decide, requireUpdated } from '../shared/mutation.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import { engagementPolicy } from './team.ts';

export const loadEngagement = Effect.fn('engagements.load')(function* (id: EngagementId) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.engagement)
    .where(and(eq(schema.engagement.tenantId, actor.tenantId), eq(schema.engagement.id, id)));
  if (!row || (row.coachId !== actor.personId && row.coacheeId !== actor.personId)) {
    return yield* Effect.fail(new NotFound({ entity: 'engagement', id }));
  }
  return row;
});

/** Anyone may propose an engagement with a coach; a coach may propose to anyone (the mesh). */
export const proposeEngagement = Effect.fn('useCase.proposeEngagement')(function* (input: {
  readonly coachId: PersonId;
  readonly coacheeId: PersonId;
  readonly note: string | null;
}) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  if (actor.personId !== input.coachId && actor.personId !== input.coacheeId) {
    return yield* Effect.fail(
      new Forbidden({ message: 'You can only propose an engagement you are part of.' }),
    );
  }
  if (input.coachId === input.coacheeId) {
    return yield* Effect.fail(new Unprocessable({ message: 'Coaching needs two people.' }));
  }
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  if (!hasCoachGrantOn(facts, input.coachId, yield* today)) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'That person is not a coach.', field: 'coachId' }),
    );
  }
  const open = yield* db
    .select({ id: schema.engagement.id })
    .from(schema.engagement)
    .where(
      and(
        eq(schema.engagement.coachId, input.coachId),
        eq(schema.engagement.coacheeId, input.coacheeId),
        inArray(schema.engagement.status, ['proposed', 'active', 'paused']),
      ),
    );
  if (open.length > 0)
    return yield* Effect.fail(new Conflict({ message: 'There is already an open engagement.' }));
  const id = EngagementId.generate();
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.engagement).values({
        id,
        tenantId: actor.tenantId,
        coachId: input.coachId,
        coacheeId: input.coacheeId,
        proposedById: actor.personId,
        status: 'proposed',
        note: input.note,
        expiresAt: addDays(at, ENGAGEMENT_PROPOSAL_DAYS),
      });
      yield* recordAudit(actor, {
        entityType: 'engagement',
        entityId: id,
        event: 'PROPOSE',
        to: 'proposed',
      });
      yield* notify(actor.tenantId, {
        recipientId: actor.personId === input.coachId ? input.coacheeId : input.coachId,
        kind: 'engagement_proposed',
        entityType: 'engagement',
        entityId: id,
        actorId: actor.personId,
      });
    }),
  );
  return id;
});

export const engagementEvent = Effect.fn('useCase.engagementEvent')(function* (
  id: EngagementId,
  event: (typeof EngagementLifecycle.events)[number],
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const row = yield* loadEngagement(id);
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const coachGrantActive = hasCoachGrantOn(facts, row.coachId, on);
  const from = row.status as EngagementStatus;
  const to = yield* decide({
    lifecycle: EngagementLifecycle,
    from,
    facts: { coachGrantActive },
    event: { type: event },
    permitted: engagementPolicy(actor, row)[event],
    ...(event === 'ACCEPT' &&
      !coachGrantActive && { explain: 'The coach no longer holds the coach role.' }),
  });
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.engagement)
        .set({
          status: to,
          version: row.version + 1,
          updatedAt: yield* now,
          ...(event === 'ACCEPT' && { acceptedOn: on }),
          ...(event === 'END' && { endedOn: on }),
        })
        .where(and(eq(schema.engagement.id, row.id), eq(schema.engagement.version, row.version)))
        .returning({ id: schema.engagement.id })
        .pipe(Effect.flatMap(requireUpdated('engagement')));
      yield* recordAudit(actor, { entityType: 'engagement', entityId: row.id, event, from, to });
    }),
  );
});
