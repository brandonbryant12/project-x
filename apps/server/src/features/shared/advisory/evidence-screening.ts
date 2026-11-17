import type { Actor } from '@repo/api';
import {
  EvidenceLifecycle,
  screenLocally,
  type EvidenceId,
  type EvidenceStatus,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { recordAudit } from '../audit.ts';
import { privacyScreen } from './question-sets.ts';
import { runCheck } from './runner.ts';

/**
 * Screening for new or revised evidence (ADR 0008, 0012) — the AI is hold-only:
 *  - the deterministic local screen holds immediately and fails closed;
 *  - text that passes it is available at once;
 *  - the assistant may then HOLD (suspected PII) or ESCALATE (complaint or
 *    specific recommendation) it. It never clears anything, and a failed or
 *    clean check changes nothing (it is still recorded on advisory_check).
 */
export const initialEvidenceState = (
  body: string,
): { status: EvidenceStatus; holdReason: string | null } => {
  const local = screenLocally(body);
  if (local.held) {
    return { status: 'held', holdReason: `Held for privacy: ${local.reasons.join('; ')}.` };
  }
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

/** Background (after commit): the assistant privacy screen may hold or escalate available text. */
export const screenEvidenceWithAssistant = Effect.fn('evidence.assistantScreen')(function* (
  actor: Actor,
  evidenceId: EvidenceId,
) {
  const db = yield* Db;
  const [evidence] = yield* db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.id, evidenceId));
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
  if (outcome.status !== 'completed') return;
  const event = HOLDING_EVENT[outcome.interpretation.effect];
  if (event === null) return;
  const next = EvidenceLifecycle.next('available', {}, { type: event });
  if (next === null) return;
  yield* transactionally(
    Effect.gen(function* () {
      const updated = yield* (
        db
          .update(schema.evidence)
          .set({
            status: next,
            holdReason: HOLD_REASONS[event],
            version: evidence.version + 1,
            updatedAt: new Date(),
          })
          // Only the exact version that was screened; a revision since then is screened again.
          .where(
            and(eq(schema.evidence.id, evidence.id), eq(schema.evidence.version, evidence.version)),
          )
          .returning({ id: schema.evidence.id })
      );
      if (updated.length === 0) return;
      yield* recordAudit(
        { tenantId: actor.tenantId, personId: null },
        {
          entityType: 'evidence',
          entityId: evidence.id,
          event,
          from: 'available',
          to: next,
          reasonCode: 'privacy_assistant',
          policyVersion: `${privacyScreen.id}@${privacyScreen.version}`,
          data: { advisoryCheckId: outcome.id },
        },
      );
    }),
  );
});
