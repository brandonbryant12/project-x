import { Conflict, CurrentActor, Forbidden, NotFound, Unprocessable } from '@repo/api';
import {
  ENGAGEMENT_PROPOSAL_DAYS,
  ENGAGEMENT_PROPOSAL_REASON_TEXT,
  EngagementId,
  EngagementLifecycle,
  checkEngagementProposal,
  hasCoachGrantOn,
  type EngagementStatus,
  type PersonId,
  type TenantId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq, inArray, or } from 'drizzle-orm';
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

/** Live engagements between two people, in either direction (proposed, active or paused). */
const liveBetween = Effect.fn('engagements.liveBetween')(function* (
  tenantId: TenantId,
  a: PersonId,
  b: PersonId,
) {
  const db = yield* Db;
  return yield* db
    .select({ coachId: schema.engagement.coachId, coacheeId: schema.engagement.coacheeId })
    .from(schema.engagement)
    .where(
      and(
        eq(schema.engagement.tenantId, tenantId),
        inArray(schema.engagement.status, ['proposed', 'active', 'paused']),
        or(
          and(eq(schema.engagement.coachId, a), eq(schema.engagement.coacheeId, b)),
          and(eq(schema.engagement.coachId, b), eq(schema.engagement.coacheeId, a)),
        ),
      ),
    );
});

/**
 * Either party may propose, in either direction, when `checkEngagementProposal`
 * allows it: the coach holds the coach grant, is not the coachee's direct
 * leader, and the pair has no live engagement either way. The profile offers
 * exactly these directions (`proposableDirections`).
 */
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
  const otherId = actor.personId === input.coachId ? input.coacheeId : input.coachId;
  const [other] = yield* db
    .select({ id: schema.person.id })
    .from(schema.person)
    .where(
      and(
        eq(schema.person.tenantId, actor.tenantId),
        eq(schema.person.id, otherId),
        eq(schema.person.status, 'active'),
      ),
    );
  if (!other) return yield* Effect.fail(new NotFound({ entity: 'person', id: otherId }));
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const id = EngagementId.generate();
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      const check = checkEngagementProposal(facts, {
        coachId: input.coachId,
        coacheeId: input.coacheeId,
        on,
        live: yield* liveBetween(actor.tenantId, input.coachId, input.coacheeId),
      });
      if (!check.ok) {
        const message = ENGAGEMENT_PROPOSAL_REASON_TEXT[check.reason];
        return yield* Effect.fail(
          check.reason === 'already_engaged'
            ? new Conflict({ message })
            : new Unprocessable({
                message,
                ...(check.reason === 'not_a_coach' && { field: 'coachId' }),
              }),
        );
      }
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
        recipientId: otherId,
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
