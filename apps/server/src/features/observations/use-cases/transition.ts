import { CurrentActor, Unprocessable, type ObservationTransitionInput } from '@repo/api';
import {
  BadgeAwardLifecycle,
  CreditReversalId,
  ObservationLifecycle,
  creditPolicyVersion,
  criteriaFromSnapshot,
  evaluateBadge,
  isEvidenceHeld,
  type BadgeLevel,
  type ObservationId,
  type ObservationStatus,
  type SkillId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { BusinessTimeZone, businessDateIn, now } from '../../../platform/time.ts';
import { recordAudit } from '../../shared/audit.ts';
import { notify } from '../../shared/notify.ts';
import { decide, requireUpdated } from '../../shared/mutation.ts';
import {
  awardEarnedBadges,
  inspectTenantCreditPolicy,
  lockPersonLedger,
  netCreditsBySkill,
  toCreditFact,
} from '../../shared/recognition.ts';
import { permittedEvents } from '../views.ts';
import { latestEvidenceStatus, loadVisible } from './shared.ts';

const NOTE_REQUIRED = new Set(['RETURN', 'DECLINE', 'REQUEST_REVIEW', 'VOID']);
const NOTE_KIND = {
  RETURN: 'return',
  DECLINE: 'decline',
  REQUEST_REVIEW: 'review',
  VOID: 'void',
  UPHOLD: 'uphold',
  // Resending may carry a new note to the observer; it replaces the request's note.
  RESUBMIT: 'request',
} as const;
/** The same limit as a request's note. */
const REQUEST_NOTE_MAX = 280;

/**
 * Every non-signing transition. Notes are the human "why" recorded on the
 * audit trail. A returned request is resent only once the requester's
 * reflection is no longer held by the privacy screen (lifecycle guard).
 */
export const transitionObservation = Effect.fn('useCase.transitionObservation')(function* (
  id: ObservationId,
  input: ObservationTransitionInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const row = yield* loadVisible(id);
  const note = input.note?.trim() || null;
  if (NOTE_REQUIRED.has(input.event) && (!note || note.length < 3)) {
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Add a short note so the other person knows why.',
        field: 'note',
      }),
    );
  }
  if (input.event === 'RESUBMIT' && note && note.length > REQUEST_NOTE_MAX) {
    return yield* Effect.fail(
      new Unprocessable({
        message: `Keep the note to ${REQUEST_NOTE_MAX} characters.`,
        field: 'note',
      }),
    );
  }
  const from = row.status as ObservationStatus;
  const reflectionHeld = isEvidenceHeld(
    yield* latestEvidenceStatus(actor.tenantId, row.interactionId),
  );
  const to = yield* decide({
    lifecycle: ObservationLifecycle,
    from,
    facts: {
      ratingsComplete: false,
      narrativeLength: 0,
      privacyHold: false,
      acknowledged: row.acknowledgedAt !== null,
      reflectionHeld,
    },
    event: { type: input.event },
    permitted: permittedEvents(actor, row).includes(input.event),
    ...(input.event === 'RESUBMIT' &&
      reflectionHeld && {
        explain:
          'Your reflection is held for a privacy check. Revise it so it clears, then resend.',
      }),
  });
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.observation)
        .set({
          status: to,
          version: row.version + 1,
          updatedAt: at,
          ...(input.event === 'ACKNOWLEDGE' && { acknowledgedAt: at }),
        })
        .where(and(eq(schema.observation.id, row.id), eq(schema.observation.version, row.version)))
        .returning({ id: schema.observation.id })
        .pipe(Effect.flatMap(requireUpdated('observation')));
      const kind = NOTE_KIND[input.event as keyof typeof NOTE_KIND];
      yield* recordAudit(actor, {
        entityType: 'observation',
        entityId: row.id,
        event: input.event,
        from,
        to,
        ...(note && kind && { note: { kind, body: note } }),
      });
      if (input.event === 'VOID') yield* reverseCredits(row.id, row.subjectId);
      if (input.event === 'RETURN') {
        yield* notify(actor.tenantId, {
          recipientId: row.requestedById,
          kind: 'observation_returned',
          entityType: 'observation',
          entityId: row.id,
          actorId: actor.personId,
          occurrence: `v${row.version + 1}`,
        });
      }
      if (input.event === 'RESUBMIT') {
        // The request waits on the observer again.
        yield* notify(actor.tenantId, {
          recipientId: row.observerId,
          kind: 'observation_requested',
          entityType: 'observation',
          entityId: row.id,
          actorId: actor.personId,
          dueOn: businessDateIn(row.dueAt, yield* BusinessTimeZone),
          occurrence: `v${row.version + 1}`,
        });
      }
    }),
  );
});

/**
 * VOID: append a reversal per credit, then revoke badges whose criteria no
 * longer hold. Each badge is judged by the thresholds saved on its award (a
 * legacy snapshot reads as N pieces of work and N × 10 points), never by the
 * policy of the day or by defaults. A revoked badge is then judged once more under the
 * current policy and, if still met, awarded again as a new award with the
 * current thresholds, so nobody who qualifies today is left without it.
 * A correction is never blocked by a configuration error: if the stored
 * credit policy cannot be read, the void and its revocations complete, the
 * re-award is skipped, and each revocation's audit event says so.
 */
const reverseCredits = Effect.fn('observations.reverseCredits')(function* (
  observationId: ObservationId,
  subjectId: typeof schema.observation.$inferSelect.subjectId,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  yield* lockPersonLedger(actor.tenantId, subjectId);
  const credits = yield* db
    .select()
    .from(schema.creditEntry)
    .where(
      and(
        eq(schema.creditEntry.tenantId, actor.tenantId),
        eq(schema.creditEntry.observationId, observationId),
      ),
    );
  if (credits.length === 0) return;
  const stored = yield* inspectTenantCreditPolicy(actor.tenantId);
  const current = stored.reading.ok ? stored.reading.policy : null;
  // A broken policy's version reads as its stored number, or 0 when it has none.
  const policyVersion = creditPolicyVersion(current ?? { version: stored.version });
  const reversals = credits.map((c) => ({
    id: CreditReversalId.generate(),
    tenantId: actor.tenantId,
    creditEntryId: c.id,
    reversedById: actor.personId,
    reasonCode: 'observation_voided',
    policyVersion,
  }));
  yield* db.insert(schema.creditReversal).values(reversals);
  const skills = [...new Set(credits.map((c) => c.skillId))] as Array<SkillId>;
  const net = yield* netCreditsBySkill(actor.tenantId, subjectId, skills);
  const badges = yield* db
    .select()
    .from(schema.badgeAward)
    .where(
      and(
        eq(schema.badgeAward.tenantId, actor.tenantId),
        eq(schema.badgeAward.personId, subjectId),
        eq(schema.badgeAward.status, 'awarded'),
      ),
    );
  const at = yield* now;
  const revoked: Array<{ skillId: SkillId; level: BadgeLevel }> = [];
  for (const badge of badges.filter(
    (b) => skills.includes(b.skillId) && (b.level === 2 || b.level === 3),
  )) {
    const saved = criteriaFromSnapshot(badge.criteria.thresholds);
    if (!saved.ok) {
      // Never judged by defaults: an unreadable snapshot is data to repair by hand.
      return yield* Effect.die(
        new Error(`badge award ${badge.id} snapshot lacks ${saved.missing.join(', ')}`),
      );
    }
    const evaluation = evaluateBadge(
      (net.get(badge.skillId) ?? []).map(toCreditFact),
      badge.level as BadgeLevel,
      saved.criteria,
    );
    if (evaluation.met || BadgeAwardLifecycle.next('awarded', {}, { type: 'REVOKE' }) === null)
      continue;
    yield* db
      .update(schema.badgeAward)
      .set({ status: 'revoked', revokedAt: at, revokedByReversalId: reversals[0]?.id ?? null })
      .where(eq(schema.badgeAward.id, badge.id));
    yield* recordAudit(actor, {
      entityType: 'badge_award',
      entityId: badge.id,
      event: 'REVOKE',
      from: 'awarded',
      to: 'revoked',
      reasonCode: 'data_correction',
      policyVersion,
      ...(current === null && {
        data: { reAward: 'skipped', because: 'the stored credit policy is not valid' },
      }),
    });
    revoked.push({ skillId: badge.skillId, level: badge.level as BadgeLevel });
  }
  if (revoked.length > 0 && current) {
    yield* awardEarnedBadges(
      actor,
      current,
      subjectId,
      [...new Set(revoked.map((r) => r.skillId))],
      undefined,
      revoked,
    );
  }
});
