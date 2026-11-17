import {
  CurrentActor,
  Conflict,
  NotFound,
  Unprocessable,
  type RequestObservationInput,
  type StartObservationInput,
} from '@repo/api';
import {
  ActivityId,
  ActivityLifecycle,
  InteractionId,
  OBSERVE_WINDOW_DAYS,
  ObservationId,
  OPEN_OBSERVATION_STATES,
  type ActivityStatus,
  type SkillId,
  type SkillVersionId,
  INTERACTION_KIND_LABELS,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import {
  BusinessTimeZone,
  addDaysIso,
  businessDateIn,
  now,
  today,
} from '../../../platform/time.ts';
import { recordAudit } from '../../shared/audit.ts';
import { notify } from '../../shared/notify.ts';
import { basisEdge } from '../../shared/relationships.ts';
import { currentPlanOf } from '../../shared/plans.ts';
import { currentVersions, dueDate, requireEligible } from './shared.ts';

const ratingRows = (
  tenantId: Parameters<typeof currentVersions>[0],
  observationId: ObservationId,
  skillIds: ReadonlyArray<SkillId>,
  versions: ReadonlyMap<SkillId, SkillVersionId>,
) =>
  skillIds.map((skillId, position) => ({
    tenantId,
    observationId,
    skillId,
    skillVersionId: versions.get(skillId) as SkillVersionId,
    level: null,
    credit: true,
    position,
  }));

/** The coachee asks an eligible observer to look at a logged interaction. */
export const requestObservation = Effect.fn('useCase.requestObservation')(function* (
  input: RequestObservationInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [interaction] = yield* db
    .select()
    .from(schema.interaction)
    .where(
      and(
        eq(schema.interaction.tenantId, actor.tenantId),
        eq(schema.interaction.id, input.interactionId),
      ),
    );
  if (!interaction || interaction.ownerId !== actor.personId) {
    return yield* Effect.fail(new NotFound({ entity: 'interaction', id: input.interactionId }));
  }
  const basis = yield* requireEligible(actor.tenantId, {
    observerId: input.observerId,
    subjectId: actor.personId,
    on: interaction.occurredOn,
  });
  const [live] = yield* db
    .select({ id: schema.observation.id })
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.interactionId, interaction.id),
        eq(schema.observation.observerId, input.observerId),
        inArray(schema.observation.status, [...OPEN_OBSERVATION_STATES, 'signed', 'under_review']),
      ),
    );
  if (live)
    return yield* Effect.fail(
      new Conflict({ message: 'You have already asked this person about this work.' }),
    );
  const versions = yield* currentVersions(actor.tenantId, input.skillIds);
  const edge = yield* basisEdge(actor.tenantId, {
    observerId: input.observerId,
    subjectId: actor.personId,
    on: interaction.occurredOn,
    basis,
  });
  const id = ObservationId.generate();
  const dueAt = yield* dueDate(actor.tenantId);
  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.observation).values({
        id,
        tenantId: actor.tenantId,
        createdAt: yield* now,
        interactionId: interaction.id,
        subjectId: actor.personId,
        observerId: input.observerId,
        requestedById: actor.personId,
        basis,
        ...edge,
        mode: input.mode,
        status: 'requested',
        dueAt,
      });
      yield* db
        .insert(schema.observationRating)
        .values(ratingRows(actor.tenantId, id, input.skillIds, versions));
      yield* recordAudit(actor, {
        entityType: 'observation',
        entityId: id,
        event: 'REQUEST',
        to: 'requested',
        data: { observerId: input.observerId, basis, mode: input.mode },
        ...(input.note && { note: { kind: 'request' as const, body: input.note } }),
      });
      yield* notify(actor.tenantId, {
        recipientId: input.observerId,
        kind: 'observation_requested',
        entityType: 'observation',
        entityId: id,
        actorId: actor.personId,
        dueOn: businessDateIn(dueAt, yield* BusinessTimeZone),
      });
    }),
  );
  return id;
});

/** "I saw this": the observer starts an observation, creating the interaction for the subject. */
export const startObservation = Effect.fn('useCase.startObservation')(function* (
  input: StartObservationInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const on = yield* today;
  if (input.occurredOn > on) {
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Observe work that has already happened.',
        field: 'occurredOn',
      }),
    );
  }
  if (input.occurredOn < addDaysIso(on, -OBSERVE_WINDOW_DAYS)) {
    return yield* Effect.fail(
      new Unprocessable({
        message: `Record what you saw within ${OBSERVE_WINDOW_DAYS} days.`,
        field: 'occurredOn',
      }),
    );
  }
  const basis = yield* requireEligible(actor.tenantId, {
    observerId: actor.personId,
    subjectId: input.subjectId,
    on: input.occurredOn,
  });
  const versions = yield* currentVersions(actor.tenantId, input.skillIds);
  const edge = yield* basisEdge(actor.tenantId, {
    observerId: actor.personId,
    subjectId: input.subjectId,
    on: input.occurredOn,
    basis,
  });
  let activityId = input.activityId;
  if (activityId) {
    const [activity] = yield* db
      .select()
      .from(schema.activity)
      .where(and(eq(schema.activity.tenantId, actor.tenantId), eq(schema.activity.id, activityId)));
    if (!activity || activity.ownerId !== input.subjectId) {
      return yield* Effect.fail(new NotFound({ entity: 'activity', id: activityId }));
    }
    if (
      ActivityLifecycle.next(activity.status as ActivityStatus, {}, { type: 'LOG_INTERACTION' }) ===
      null
    ) {
      return yield* Effect.fail(
        new Unprocessable({ message: 'That activity is closed. Describe the work instead.' }),
      );
    }
  } else if (input.title && input.title.trim().length > 0 && input.title.trim().length < 3) {
    // A name is optional (the kind's label stands in); a given name must say something.
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Name the work in a few words, or leave it blank.',
        field: 'title',
      }),
    );
  }
  const id = ObservationId.generate();
  const interactionId = InteractionId.generate();
  const dueAt = yield* dueDate(actor.tenantId);
  yield* transactionally(
    Effect.gen(function* () {
      if (!activityId) {
        activityId = ActivityId.generate();
        const plan = yield* currentPlanOf(actor.tenantId, input.subjectId);
        yield* db.insert(schema.activity).values({
          id: activityId,
          tenantId: actor.tenantId,
          planId: plan?.id ?? null,
          ownerId: input.subjectId,
          title: input.title?.trim() || INTERACTION_KIND_LABELS[input.kind],
          origin: 'ad_hoc',
          status: 'planned',
        });
      }
      const [activity] = yield* db
        .select()
        .from(schema.activity)
        .where(eq(schema.activity.id, activityId));
      if (!activity) return yield* Effect.die('invariant: activity vanished');
      const next = ActivityLifecycle.next(
        activity.status as ActivityStatus,
        {},
        { type: 'LOG_INTERACTION' },
      );
      if (next && next !== activity.status) {
        yield* db
          .update(schema.activity)
          .set({ status: next, version: activity.version + 1, updatedAt: yield* now })
          .where(eq(schema.activity.id, activity.id));
      }
      yield* db.insert(schema.interaction).values({
        id: interactionId,
        tenantId: actor.tenantId,
        activityId: activity.id,
        ownerId: input.subjectId,
        loggedById: actor.personId,
        occurredOn: input.occurredOn,
        kind: input.kind,
        clientRef: null,
      });
      yield* db.insert(schema.observation).values({
        id,
        tenantId: actor.tenantId,
        createdAt: yield* now,
        interactionId,
        subjectId: input.subjectId,
        observerId: actor.personId,
        requestedById: actor.personId,
        basis,
        ...edge,
        mode: input.mode,
        status: 'drafting',
        dueAt,
      });
      yield* db
        .insert(schema.observationRating)
        .values(ratingRows(actor.tenantId, id, input.skillIds, versions));
      yield* recordAudit(actor, {
        entityType: 'observation',
        entityId: id,
        event: 'START',
        to: 'drafting',
        data: { subjectId: input.subjectId, basis, mode: input.mode, observerInitiated: true },
      });
    }),
  );
  return id;
});
