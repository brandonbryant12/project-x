import {
  EvidenceLifecycle,
  screenLocally,
  type EvidenceId,
  type EvidenceStatus,
  type TenantId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../../../platform/time.ts';
import { recordAudit } from '../audit.ts';
import { privacyScreen } from './question-sets.ts';
import { runCheck } from './runner.ts';

/** The policy version recorded when the deterministic local screen holds text. */
const LOCAL_SCREEN_POLICY = 'local-screen@1';

const localHoldReason = (reasons: ReadonlyArray<string>) =>
  `Held for privacy: ${reasons.join('; ')}.`;

/**
 * Screening for new or revised evidence (ADR 0008, 0012) — the AI is hold-only:
 *  - the deterministic local screen holds immediately and fails closed;
 *  - text that passes it is available at once;
 *  - the assistant may then HOLD (suspected PII) or ESCALATE (complaint or
 *    specific recommendation) it. It never clears anything, and a failed or
 *    clean check changes nothing (it is still recorded on advisory_check);
 *  - text the local screen holds never reaches the assistant (runner.ts), and a
 *    screen lost between commit and run is recovered by the screening sweep
 *    (scheduler/screening.ts).
 */
export const initialEvidenceState = (
  body: string,
): { status: EvidenceStatus; holdReason: string | null } => {
  const local = screenLocally(body);
  if (local.held) return { status: 'held', holdReason: localHoldReason(local.reasons) };
  return { status: 'available', holdReason: null };
};

/** The only transitions the assistant may cause. There is no clearing event. */
const HOLDING_EVENT: Readonly<
  Record<'hold' | 'escalate' | 'nudge' | 'none', 'HOLD' | 'ESCALATE' | null>
> = {
  hold: 'HOLD',
  escalate: 'ESCALATE',
  nudge: null,
  none: null,
};

const HOLD_REASONS: Readonly<Record<'HOLD' | 'ESCALATE', string>> = {
  HOLD: 'Held for privacy. This appears to include client details, so it has not been shared with anyone.',
  ESCALATE:
    'Sent to compliance. It appears to describe a client complaint or a specific recommendation.',
};

type EvidenceRow = typeof schema.evidence.$inferSelect;

/**
 * A system hold of available text (no human actor): only the exact version
 * that was screened, through the evidence lifecycle, audited in the same
 * transaction. A revision since the screen is screened again instead.
 */
const holdScreenedVersion = Effect.fn('evidence.holdScreened')(function* (
  evidence: EvidenceRow,
  event: 'HOLD' | 'ESCALATE',
  hold: {
    readonly reason: string;
    readonly reasonCode: 'privacy_local' | 'privacy_assistant';
    readonly policyVersion: string;
    readonly advisoryCheckId: string;
  },
) {
  const db = yield* Db;
  const next = EvidenceLifecycle.next('available', {}, { type: event });
  if (next === null) return;
  yield* transactionally(
    Effect.gen(function* () {
      const updated = yield* db
        .update(schema.evidence)
        .set({
          status: next,
          holdReason: hold.reason,
          version: evidence.version + 1,
          updatedAt: yield* now,
        })
        .where(
          and(
            eq(schema.evidence.tenantId, evidence.tenantId),
            eq(schema.evidence.id, evidence.id),
            eq(schema.evidence.version, evidence.version),
            eq(schema.evidence.status, 'available'),
          ),
        )
        .returning({ id: schema.evidence.id });
      if (updated.length === 0) return;
      yield* recordAudit(
        { tenantId: evidence.tenantId, personId: null },
        {
          entityType: 'evidence',
          entityId: evidence.id,
          event,
          from: 'available',
          to: next,
          reasonCode: hold.reasonCode,
          policyVersion: hold.policyVersion,
          data: { advisoryCheckId: hold.advisoryCheckId },
        },
      );
    }),
  );
});

/**
 * Background (after commit, or the screening sweep): the assistant privacy
 * screen may hold or escalate available text. If the local screen now holds
 * the text (a rule added since it was written), nothing is sent and the local
 * rule holds it.
 */
export const screenEvidenceWithAssistant = Effect.fn('evidence.assistantScreen')(function* (
  actor: { readonly tenantId: TenantId },
  evidenceId: EvidenceId,
) {
  const db = yield* Db;
  const [evidence] = yield* db
    .select()
    .from(schema.evidence)
    .where(and(eq(schema.evidence.tenantId, actor.tenantId), eq(schema.evidence.id, evidenceId)));
  if (!evidence || evidence.status !== 'available' || evidence.body === null) return;
  const built = privacyScreen.build();
  const outcome = yield* runCheck({
    actor,
    questionSet: privacyScreen,
    built,
    subjectType: 'evidence',
    subjectId: evidence.id,
    subjectVersion: evidence.version,
    text: evidence.body,
    interpret: (result) => privacyScreen.interpret(result.answers, built.thresholds),
  });
  if (outcome.status === 'skipped' && outcome.heldLocally !== null) {
    yield* holdScreenedVersion(evidence, 'HOLD', {
      reason: localHoldReason(outcome.heldLocally),
      reasonCode: 'privacy_local',
      policyVersion: LOCAL_SCREEN_POLICY,
      advisoryCheckId: outcome.id,
    });
    return;
  }
  if (outcome.status !== 'completed') return;
  const event = HOLDING_EVENT[outcome.interpretation.effect];
  if (event === null) return;
  yield* holdScreenedVersion(evidence, event, {
    reason: HOLD_REASONS[event],
    reasonCode: 'privacy_assistant',
    policyVersion: `${privacyScreen.id}@${privacyScreen.version}`,
    advisoryCheckId: outcome.id,
  });
});
