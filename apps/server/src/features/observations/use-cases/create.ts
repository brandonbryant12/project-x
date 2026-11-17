import {
  CurrentActor,
  Conflict,
  NotFound,
  Unprocessable,
  type Actor,
  type RequestObservationInput,
  type StartObservationInput,
} from '@repo/api';
import {
  ActivityId,
  ActivityLifecycle,
  InteractionId,
  OBSERVE_WINDOW_DAYS,
  ObservationId,
  canViewDevelopment,
  isEvidenceHeld,
  type ActivityStatus,
  type IsoDate,
  type SkillId,
  type SkillRole,
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
import { basisEdge, loadRelationshipFacts } from '../../shared/relationships.ts';
import { currentPlanOf } from '../../shared/plans.ts';
import { tenantCreditPolicy } from '../../shared/recognition.ts';
import { LIVE_OR_SIGNED } from '../views.ts';
import { requireSkillLimit, rolesFor, skillsOfActivity } from './roles.ts';
import { currentVersions, dueDate, latestEvidenceStatus, requireEligible } from './shared.ts';

/** Rating rows for a new observation, levels empty, each with its role in the work (design §4). */
const ratingRows = (
  tenantId: Parameters<typeof currentVersions>[0],
  observationId: ObservationId,
  skillIds: ReadonlyArray<SkillId>,
  versions: ReadonlyMap<SkillId, SkillVersionId>,
  roles: ReadonlyArray<SkillRole>,
) =>
  skillIds.map((skillId, position) => ({
    tenantId,
    observationId,
    skillId,
    skillVersionId: versions.get(skillId) as SkillVersionId,
    level: null,
    credit: true,
    position,
    role: roles[position] as SkillRole,
  }));

/**
 * Default roles for a new observation's ratings: each skill's role on the
 * activity, else secondary; with no primary among them, the first is primary.
 * From here on the observer owns them.
 */
const initialRoles = (
  tenantId: Parameters<typeof currentVersions>[0],
  activityId: ActivityId | null,
  skillIds: ReadonlyArray<SkillId>,
) =>
  Effect.gen(function* () {
    yield* requireSkillLimit(yield* tenantCreditPolicy(tenantId), skillIds.length);
    const skills = activityId ? yield* skillsOfActivity(tenantId, activityId) : [];
    return yield* rolesFor(
      skills,
      skillIds.map((skillId) => ({ skillId })),
    );
  });

/** Refuses an observer's second open or signed observation of the same work. */
const requireNotObservedBy = Effect.fn('observations.requireNotObservedBy')(function* (
  actor: Actor,
  interactionId: InteractionId,
  observerId: Actor['personId'],
  message: string,
) {
  const db = yield* Db;
  const [live] = yield* db
    .select({ id: schema.observation.id })
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.tenantId, actor.tenantId),
        eq(schema.observation.interactionId, interactionId),
        eq(schema.observation.observerId, observerId),
        inArray(schema.observation.status, LIVE_OR_SIGNED),
      ),
    );
  if (live) return yield* Effect.fail(new Conflict({ message }));
});

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
  // Text held for client details goes to nobody: nothing is asked of an observer until it clears.
  if (isEvidenceHeld(yield* latestEvidenceStatus(actor.tenantId, interaction.id))) {
    return yield* Effect.fail(
      new Unprocessable({
        message:
          'Your reflection is held for a privacy check. Revise it before asking anyone to observe this work.',
        field: 'reflection',
      }),
    );
  }
  const basis = yield* requireEligible(actor.tenantId, {
    observerId: input.observerId,
    subjectId: actor.personId,
    on: interaction.occurredOn,
  });
  yield* requireNotObservedBy(
    actor,
    interaction.id,
    input.observerId,
    'You have already asked this person about this work.',
  );
  const versions = yield* currentVersions(actor.tenantId, input.skillIds);
  const roles = yield* initialRoles(actor.tenantId, interaction.activityId, input.skillIds);
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
        .values(ratingRows(actor.tenantId, id, input.skillIds, versions, roles));
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

/** Work is observed close to when it happened (invariant I16). */
const requireInsideObserveWindow = (occurredOn: IsoDate, on: IsoDate) => {
  if (occurredOn > on) {
    return Effect.fail(
      new Unprocessable({
        message: 'Observe work that has already happened.',
        field: 'occurredOn',
      }),
    );
  }
  if (occurredOn < addDaysIso(on, -OBSERVE_WINDOW_DAYS)) {
    return Effect.fail(
      new Unprocessable({
        message: `Record what you saw within ${OBSERVE_WINDOW_DAYS} days.`,
        field: 'occurredOn',
      }),
    );
  }
  return Effect.void;
};

/**
 * Work the subject already logged that "I saw this" attaches to (design §9):
 * it must be theirs, the observer must have development access to them (their
 * coach or leader chain; logged work is development data, B1), and this
 * observer must not already have an open or signed observation of it. Its date
 * and kind are the work's own; the caller then requires the observer to have
 * been eligible on that date, exactly as the offered list does.
 */
const attachableInteraction = Effect.fn('observations.attachable')(function* (
  actor: Actor,
  subjectId: Actor['personId'],
  interactionId: InteractionId,
) {
  const db = yield* Db;
  const [work] = yield* db
    .select()
    .from(schema.interaction)
    .where(
      and(
        eq(schema.interaction.tenantId, actor.tenantId),
        eq(schema.interaction.id, interactionId),
      ),
    );
  const mayAttach =
    work !== undefined &&
    work.ownerId === subjectId &&
    canViewDevelopment(yield* loadRelationshipFacts(actor.tenantId), {
      viewerId: actor.personId,
      subjectId,
      on: yield* today,
    });
  if (!work || !mayAttach) {
    return yield* Effect.fail(new NotFound({ entity: 'interaction', id: interactionId }));
  }
  yield* requireNotObservedBy(
    actor,
    work.id,
    actor.personId,
    'You have already observed this work. Open that observation instead.',
  );
  return work;
});

/**
 * "I saw this": the observer starts an observation. It creates the
 * interaction for the subject, or attaches to work the subject already logged
 * so that one piece of work is never recorded twice.
 */
export const startObservation = Effect.fn('useCase.startObservation')(function* (
  input: StartObservationInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const logged = input.interactionId
    ? yield* attachableInteraction(actor, input.subjectId, input.interactionId)
    : null;
  const occurredOn = logged?.occurredOn ?? input.occurredOn;
  yield* requireInsideObserveWindow(occurredOn, yield* today);
  const basis = yield* requireEligible(actor.tenantId, {
    observerId: actor.personId,
    subjectId: input.subjectId,
    on: occurredOn,
  });
  const versions = yield* currentVersions(actor.tenantId, input.skillIds);
  const edge = yield* basisEdge(actor.tenantId, {
    observerId: actor.personId,
    subjectId: input.subjectId,
    on: occurredOn,
    basis,
  });
  let activityId = logged?.activityId ?? input.activityId;
  if (!logged && activityId) {
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
        new Unprocessable({ message: 'That planned work is closed. Describe the work instead.' }),
      );
    }
  } else if (
    !logged &&
    input.title &&
    input.title.trim().length > 0 &&
    input.title.trim().length < 3
  ) {
    // A name is optional (the kind's label stands in); a given name must say something.
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Name the work in a few words, or leave it blank.',
        field: 'title',
      }),
    );
  }
  const roles = yield* initialRoles(actor.tenantId, activityId ?? null, input.skillIds);
  const id = ObservationId.generate();
  const interactionId = logged?.id ?? InteractionId.generate();
  const dueAt = yield* dueDate(actor.tenantId);
  yield* transactionally(
    Effect.gen(function* () {
      if (!logged) {
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
          occurredOn,
          kind: input.kind,
          clientRef: null,
        });
      }
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
        .values(ratingRows(actor.tenantId, id, input.skillIds, versions, roles));
      yield* recordAudit(actor, {
        entityType: 'observation',
        entityId: id,
        event: 'START',
        to: 'drafting',
        data: {
          subjectId: input.subjectId,
          basis,
          mode: input.mode,
          observerInitiated: true,
          attachedToLoggedWork: logged !== null,
        },
      });
    }),
  );
  return id;
});
