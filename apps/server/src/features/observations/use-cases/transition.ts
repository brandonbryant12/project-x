import { CurrentActor, Unprocessable, type ObservationTransitionInput } from '@repo/api';
import {
  BadgeAwardLifecycle,
  CreditReversalId,
  ObservationLifecycle,
  SCORING_POLICY_VERSION,
  evaluateBadge,
  type BadgeLevel,
  type ObservationId,
  type ObservationStatus,
  type SkillId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../../../platform/time.ts';
import { recordAudit } from '../../shared/audit.ts';
import { notify } from '../../shared/notify.ts';
import { decide, requireUpdated } from '../../shared/mutation.ts';
import {
  lockPersonLedger,
  netCreditsBySkill,
  tenantCriteria,
  toCreditFact,
} from '../../shared/recognition.ts';
import { permittedEvents } from '../views.ts';
import { loadVisible } from './shared.ts';

const NOTE_REQUIRED = new Set(['RETURN', 'DECLINE', 'REQUEST_REVIEW', 'VOID']);
const NOTE_KIND = {
  RETURN: 'return',
  DECLINE: 'decline',
  REQUEST_REVIEW: 'review',
  VOID: 'void',
  UPHOLD: 'uphold',
} as const;

/** Every non-signing transition. Notes are the human "why" recorded on the audit trail. */
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
  const from = row.status as ObservationStatus;
  const to = yield* decide({
    lifecycle: ObservationLifecycle,
    from,
    facts: {
      ratingsComplete: false,
      narrativeLength: 0,
      privacyHold: false,
      acknowledged: row.acknowledgedAt !== null,
    },
    event: { type: input.event },
    permitted: permittedEvents(actor, row).includes(input.event),
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
    }),
  );
});

/** VOID: append a reversal per credit, then revoke badges whose criteria no longer hold. */
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
    .where(eq(schema.creditEntry.observationId, observationId));
  if (credits.length === 0) return;
  const reversals = credits.map((c) => ({
    id: CreditReversalId.generate(),
    tenantId: actor.tenantId,
    creditEntryId: c.id,
    reversedById: actor.personId,
    reasonCode: 'observation_voided',
    policyVersion: SCORING_POLICY_VERSION,
  }));
  yield* db.insert(schema.creditReversal).values(reversals);
  const skills = [...new Set(credits.map((c) => c.skillId))] as Array<SkillId>;
  const [criteria, net] = yield* Effect.all([
    tenantCriteria(actor.tenantId),
    netCreditsBySkill(actor.tenantId, subjectId, skills),
  ]);
  const badges = yield* db
    .select()
    .from(schema.badgeAward)
    .where(and(eq(schema.badgeAward.personId, subjectId), eq(schema.badgeAward.status, 'awarded')));
  const at = yield* now;
  for (const badge of badges.filter(
    (b) => skills.includes(b.skillId) && (b.level === 2 || b.level === 3),
  )) {
    const evaluation = evaluateBadge(
      (net.get(badge.skillId) ?? []).map(toCreditFact),
      badge.level as BadgeLevel,
      criteria,
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
      policyVersion: SCORING_POLICY_VERSION,
    });
  }
});
