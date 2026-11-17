import {
  Conflict,
  CurrentActor,
  Forbidden,
  Unprocessable,
  type Actor,
  type ObservationDraftInput,
} from '@repo/api';
import {
  CreditId,
  MIN_NARRATIVE_LENGTH,
  ObservationLifecycle,
  creditPolicyVersion,
  isFirstHand,
  screenLocally,
  type CreditPolicy,
  type IsoDate,
  type ObservationId,
  type ObservationMode,
  type ObservationStatus,
  type SkillId,
  type SkillIndicatorId,
  type SkillRole,
  type SkillVersionId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../../../platform/time.ts';
import { recordAudit } from '../../shared/audit.ts';
import { notify } from '../../shared/notify.ts';
import { decide, requireUpdated } from '../../shared/mutation.ts';
import { digestOf } from '../../shared/notes.ts';
import {
  awardEarnedBadges,
  lockPersonLedger,
  tenantCreditPolicy,
} from '../../shared/recognition.ts';
import { creditValues, positionOn, requireSkillLimit, rolesFor, skillsOfWork } from './roles.ts';
import { currentVersions, loadVisible, requireEligible } from './shared.ts';

type ObservationRow = typeof schema.observation.$inferSelect;

/** A role stored on an unsigned rating; `unclassified` (legacy, signed only) is treated as none. */
const storedRole = (role: string | undefined): SkillRole | undefined =>
  role === 'primary' || role === 'secondary' ? role : undefined;

const requireObserver = (actor: Actor, row: ObservationRow) =>
  row.observerId === actor.personId
    ? Effect.void
    : Effect.fail(new Forbidden({ message: 'Only the observer can write this observation.' }));

/**
 * Validates and writes the draft (ratings, ticks, narrative) inside the
 * caller's transaction. The observer owns each rating's role (design §4, like
 * the mode): their choice, else the role already stored on the rating, else
 * the activity's default. Two primaries are refused. Only the observer reaches
 * this (`requireObserver`), so a subject can never set a role.
 */
const writeDraft = Effect.fn('observations.writeDraft')(function* (
  actor: Actor,
  row: ObservationRow,
  input: ObservationDraftInput,
  status: ObservationStatus,
  policy: CreditPolicy,
) {
  const db = yield* Db;
  if (input.version !== row.version) {
    return yield* Effect.fail(
      new Conflict({ message: 'This observation changed in another window. Reload to continue.' }),
    );
  }
  const skillIds = input.ratings.map((r) => r.skillId);
  if (new Set(skillIds).size !== skillIds.length) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Rate each skill once.', field: 'ratings' }),
    );
  }
  yield* requireSkillLimit(policy, skillIds.length);
  const existing = yield* db
    .select()
    .from(schema.observationRating)
    .where(eq(schema.observationRating.observationId, row.id));
  const roles = yield* rolesFor(
    yield* skillsOfWork(actor.tenantId, row.interactionId),
    input.ratings.map((r) => ({
      skillId: r.skillId,
      chosen: r.role,
      stored: storedRole(existing.find((x) => x.skillId === r.skillId)?.role),
    })),
  );
  const pinned = new Map<SkillId, SkillVersionId>(
    existing.map((r) => [r.skillId, r.skillVersionId]),
  );
  const added = skillIds.filter((id) => !pinned.has(id));
  if (added.length > 0) {
    for (const [skillId, versionId] of yield* currentVersions(actor.tenantId, added))
      pinned.set(skillId, versionId);
  }
  const allTicks = input.ratings.flatMap((r) =>
    r.indicatorIds.map((indicatorId) => ({ skillId: r.skillId, indicatorId })),
  );
  if (allTicks.length > 0) {
    const indicators = yield* db
      .select({ id: schema.skillIndicator.id, versionId: schema.skillIndicator.skillVersionId })
      .from(schema.skillIndicator)
      .where(
        inArray(
          schema.skillIndicator.id,
          allTicks.map((t) => t.indicatorId),
        ),
      );
    const versionOf = new Map(indicators.map((i) => [i.id as SkillIndicatorId, i.versionId]));
    if (allTicks.some((t) => versionOf.get(t.indicatorId) !== pinned.get(t.skillId))) {
      return yield* Effect.fail(
        new Unprocessable({
          message: 'An indicator does not belong to that skill.',
          field: 'ratings',
        }),
      );
    }
  }
  const updated = yield* db
    .update(schema.observation)
    .set({
      status,
      // The observer owns the mode: first-hand status is never self-asserted.
      mode: input.mode,
      narrativeSaw: input.narrativeSaw,
      narrativeNext: input.narrativeNext,
      version: row.version + 1,
      updatedAt: yield* now,
    })
    .where(and(eq(schema.observation.id, row.id), eq(schema.observation.version, row.version)))
    .returning()
    .pipe(Effect.flatMap(requireUpdated('observation')));
  yield* db
    .delete(schema.observationIndicator)
    .where(eq(schema.observationIndicator.observationId, row.id));
  yield* db
    .delete(schema.observationRating)
    .where(eq(schema.observationRating.observationId, row.id));
  if (input.ratings.length > 0) {
    yield* db.insert(schema.observationRating).values(
      input.ratings.map((r, position) => ({
        tenantId: actor.tenantId,
        observationId: row.id,
        skillId: r.skillId,
        skillVersionId: pinned.get(r.skillId) as SkillVersionId,
        level: r.level,
        credit: r.credit,
        position,
        role: roles[position] as SkillRole,
      })),
    );
  }
  if (allTicks.length > 0) {
    yield* db.insert(schema.observationIndicator).values(
      allTicks.map((t) => ({
        tenantId: actor.tenantId,
        observationId: row.id,
        skillId: t.skillId,
        skillVersionId: pinned.get(t.skillId) as SkillVersionId,
        indicatorId: t.indicatorId,
      })),
    );
  }
  return updated;
});

/**
 * Appends one credit per credited rating, inside the signing transaction: the
 * stored rating role, the points resolved now (and frozen), their source, the
 * composed policy version and the subject's position on the interaction date.
 */
const appendCredits = Effect.fn('observations.appendCredits')(function* (
  actor: Actor,
  row: ObservationRow,
  interaction: { readonly occurredOn: IsoDate },
  mode: ObservationMode,
  policy: CreditPolicy,
) {
  const db = yield* Db;
  const policyVersion = creditPolicyVersion(policy);
  const ratings = yield* db
    .select()
    .from(schema.observationRating)
    .where(eq(schema.observationRating.observationId, row.id));
  const valueOf = yield* creditValues(
    actor.tenantId,
    policy,
    yield* skillsOfWork(actor.tenantId, row.interactionId),
    ratings.map((r) => r.skillId),
  );
  const subjectPositionId = yield* positionOn(
    actor.tenantId,
    row.subjectId,
    interaction.occurredOn,
  );
  const creditable = ratings
    .filter((r) => r.credit && r.level !== null)
    .toSorted((a, b) => a.position - b.position);
  // writeDraft just stored a primary or secondary role on every rating.
  if (creditable.some((r) => !storedRole(r.role))) {
    return yield* Effect.die('invariant: a rating has no role at signing');
  }
  const credited = creditable.map((r) => {
    const role = storedRole(r.role) as SkillRole;
    return { rating: r, role, ...valueOf(r.skillId, role) };
  });
  if (credited.length > 0) {
    yield* db.insert(schema.creditEntry).values(
      credited.map(({ rating, role, points, source }) => ({
        id: CreditId.generate(),
        tenantId: actor.tenantId,
        personId: row.subjectId,
        skillId: rating.skillId,
        observationId: row.id,
        interactionId: row.interactionId,
        observerId: actor.personId,
        skillVersionId: rating.skillVersionId,
        level: rating.level as number,
        subjectPositionId,
        mode,
        isFirstHand: isFirstHand(mode),
        demonstratedOn: interaction.occurredOn,
        role,
        points,
        pointsSource: source,
        policyVersion,
      })),
    );
  }
  return { ratings, credited };
});

export const saveDraft = Effect.fn('useCase.saveObservationDraft')(function* (
  id: ObservationId,
  input: ObservationDraftInput,
) {
  const actor = yield* CurrentActor;
  const row = yield* loadVisible(id);
  yield* requireObserver(actor, row);
  const policy = yield* tenantCreditPolicy(actor.tenantId);
  const to = yield* decide({
    lifecycle: ObservationLifecycle,
    from: row.status as ObservationStatus,
    facts: { ratingsComplete: false, narrativeLength: 0, privacyHold: false, acknowledged: false },
    event: { type: 'SAVE_DRAFT' },
    permitted: true,
  });
  yield* transactionally(writeDraft(actor, row, input, to, policy));
});

/**
 * SIGN — the only code path that writes credit (ADR 0007, invariant I2).
 * Re-checks eligibility as of the interaction date, then in ONE transaction:
 * saves the final draft, signs, appends one demonstration per credited skill
 * with its role, its points (resolved now and frozen) and the subject's
 * position, awards newly met badges and audits it all.
 */
export const signObservation = Effect.fn('useCase.signObservation')(function* (
  id: ObservationId,
  input: ObservationDraftInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const row = yield* loadVisible(id);
  yield* requireObserver(actor, row);
  const [interaction] = yield* db
    .select()
    .from(schema.interaction)
    .where(eq(schema.interaction.id, row.interactionId));
  if (!interaction) return yield* Effect.die('invariant: observation without interaction');
  yield* requireEligible(actor.tenantId, {
    observerId: actor.personId,
    subjectId: row.subjectId,
    on: interaction.occurredOn,
  });
  const narrativeScreen = screenLocally(`${input.narrativeSaw}\n${input.narrativeNext}`);
  const policy = yield* tenantCreditPolicy(actor.tenantId);
  const policyVersion = creditPolicyVersion(policy);
  const from = row.status as ObservationStatus;
  yield* decide({
    lifecycle: ObservationLifecycle,
    from,
    facts: {
      ratingsComplete:
        input.ratings.length >= 1 &&
        input.ratings.length <= policy.maxSkillsPerObservation &&
        input.ratings.every((r) => r.level !== null),
      narrativeLength: input.narrativeSaw.trim().length,
      privacyHold: narrativeScreen.held,
      acknowledged: false,
    },
    event: { type: 'SIGN' },
    permitted: true,
    explain: narrativeScreen.held
      ? `Your note appears to include client details (${narrativeScreen.reasons.join('; ').toLowerCase()}). Remove them to sign.`
      : `To sign, give each skill a level and write at least ${MIN_NARRATIVE_LENGTH} characters about what you saw.`,
  });
  const signedAt = yield* now;
  const mode = input.mode;

  const awarded = yield* transactionally(
    Effect.gen(function* () {
      // Serialize ledger writes per person: concurrent signatures by two observers
      // must both see each other's credit when evaluating badges (schema review #5).
      yield* lockPersonLedger(actor.tenantId, row.subjectId);
      const drafted = yield* writeDraft(
        actor,
        row,
        input,
        from === 'requested' ? 'drafting' : from,
        policy,
      );
      yield* db
        .update(schema.observation)
        .set({
          status: 'signed',
          signedAt,
          contentDigest: digestOf(`${input.narrativeSaw}\u0000${input.narrativeNext}`),
          version: drafted.version + 1,
          updatedAt: signedAt,
        })
        .where(
          and(eq(schema.observation.id, row.id), eq(schema.observation.version, drafted.version)),
        )
        .returning({ id: schema.observation.id })
        .pipe(Effect.flatMap(requireUpdated('observation')));
      const { ratings, credited } = yield* appendCredits(actor, row, interaction, mode, policy);
      yield* recordAudit(actor, {
        entityType: 'observation',
        entityId: row.id,
        event: 'SIGN',
        from,
        to: 'signed',
        policyVersion,
        data: {
          basis: row.basis,
          mode,
          credited: credited.map(({ rating, role, points, source }) => ({
            skillId: rating.skillId,
            level: rating.level,
            role,
            points,
            pointsSource: source,
          })),
          feedbackOnly: input.ratings.filter((r) => !r.credit).map((r) => r.skillId),
          // The roles the observer signed, feedback-only ratings included.
          roles: Object.fromEntries(ratings.map((r) => [r.skillId, r.role])),
        },
      });
      yield* notify(actor.tenantId, {
        recipientId: row.subjectId,
        kind: 'observation_signed',
        entityType: 'observation',
        entityId: row.id,
        actorId: actor.personId,
      });
      return yield* awardEarnedBadges(
        actor,
        row.subjectId,
        credited.map((c) => c.rating.skillId),
        row.id,
      );
    }),
  );
  return { awarded };
});
