import type { Actor } from '@repo/api';
import { AdvisoryLabelId, type LabelSource, type SkillId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { afterCommit } from '../../../platform/background-context.ts';
import { Tracing } from '../../../platform/langsmith.ts';
import { narrativeIndicators, privacyScreen, skillSuggest } from './question-sets.ts';

/**
 * Ground truth from real actions (ADR 0016). Labels are derived on the server in
 * the same transaction as the human action — nobody is asked "was this
 * helpful?". One label per question. Text never moves: labels point to it.
 */
type CheckRow = typeof schema.advisoryCheck.$inferSelect;

const latestCheck = Effect.fn('labels.latestCheck')(function* (
  actor: Actor,
  questionSet: string,
  subjectType: string,
  subjectId: string,
) {
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.advisoryCheck)
    .where(
      and(
        eq(schema.advisoryCheck.tenantId, actor.tenantId),
        eq(schema.advisoryCheck.questionSet, questionSet),
        eq(schema.advisoryCheck.subjectType, subjectType),
        eq(schema.advisoryCheck.subjectId, subjectId),
        eq(schema.advisoryCheck.status, 'completed'),
      ),
    )
    .orderBy(desc(schema.advisoryCheck.createdAt))
    .limit(1);
  return row;
});

const probabilityOf = (check: CheckRow, key: string): number | null => {
  const answer = check.answers?.answers[key] as { kind?: string; probability?: number } | undefined;
  return answer?.kind === 'binary' && typeof answer.probability === 'number'
    ? answer.probability
    : null;
};

const writeLabels = Effect.fn('labels.write')(function* (
  actor: Actor,
  check: CheckRow,
  labels: ReadonlyArray<{
    readonly questionKey: string;
    readonly value: string;
    readonly source: LabelSource;
    readonly strength: 'gold' | 'silver' | 'weak';
    readonly threshold: number | null;
  }>,
  labelerRole: string,
) {
  if (labels.length === 0) return;
  const db = yield* Db;
  const tracing = yield* Tracing;
  if (tracing.enabled && check.traceRunId) {
    const runId = check.traceRunId;
    // Network call after commit, never inside the transaction (ADR 0003).
    yield* afterCommit(
      Effect.forEach(labels, (label) =>
        tracing.feedback(runId, `label.${label.questionKey}`, label.value === 'yes' ? 1 : 0, {
          source: label.source,
          strength: label.strength,
          arm: check.arm,
        }),
      ),
    );
  }
  yield* db.insert(schema.advisoryLabel).values(
    labels.map((label) => ({
      id: AdvisoryLabelId.generate(),
      tenantId: actor.tenantId,
      checkId: check.id,
      questionKey: label.questionKey,
      questionSet: check.questionSet,
      questionSetVersion: check.questionSetVersion,
      modelProbability: probabilityOf(check, label.questionKey),
      threshold: label.threshold,
      labelValue: label.value,
      source: label.source,
      strength: label.strength,
      arm: check.arm,
      labelerId: actor.personId,
      labelerRole,
      inputEntityType: check.subjectType,
      inputEntityId: check.subjectId,
      inputDigest: check.inputDigest,
    })),
  );
});

/**
 * At signing: the observer's final indicators label `narrative-indicators`
 * (a tick is a confident yes; an untick is weak, since ticks are optional),
 * and the final rated skills label `skill-suggest`.
 */
export const labelFromSigning = Effect.fn('labels.fromSigning')(function* (
  actor: Actor,
  input: {
    readonly observationId: string;
    readonly interactionId: string;
    readonly tickedIndicatorIds: ReadonlyArray<string>;
    readonly candidateIndicatorIds: ReadonlyArray<string>;
    readonly ratedSkillIds: ReadonlyArray<SkillId>;
  },
) {
  const indicatorsCheck = yield* latestCheck(
    actor,
    narrativeIndicators.id,
    'observation',
    input.observationId,
  );
  if (indicatorsCheck) {
    const ticked = new Set(input.tickedIndicatorIds);
    const threshold = indicatorsCheck.thresholds['addresses'] ?? null;
    yield* writeLabels(
      actor,
      indicatorsCheck,
      input.candidateIndicatorIds.map((id) => ({
        questionKey: narrativeIndicators.indicatorKey(id),
        value: ticked.has(id) ? 'yes' : 'no',
        source: ticked.has(id) ? 'tick_kept' : 'tick_removed',
        strength: ticked.has(id) ? 'silver' : 'weak',
        threshold,
      })),
      'observer',
    );
  }
  const suggestCheck = yield* latestCheck(
    actor,
    skillSuggest.id,
    'interaction',
    input.interactionId,
  );
  if (suggestCheck) {
    const rated = new Set<string>(input.ratedSkillIds.map((id) => `skl_${id.slice(4)}`));
    yield* writeLabels(
      actor,
      suggestCheck,
      Object.keys(suggestCheck.answers?.answers ?? {}).map((key) => ({
        questionKey: key,
        value: rated.has(key) ? 'yes' : 'no',
        source: 'skill_final',
        strength: 'silver',
        threshold: suggestCheck.thresholds['suggest'] ?? null,
      })),
      'observer',
    );
  }
});

/**
 * Privacy holds: an admin releasing held text unchanged says the hold was wrong
 * (gold); the author revising it is weak evidence the hold was right.
 */
export const labelFromPrivacyDecision = Effect.fn('labels.fromPrivacy')(function* (
  actor: Actor,
  evidenceId: string,
  decision: 'released' | 'revised',
) {
  const check = yield* latestCheck(actor, privacyScreen.id, 'evidence', evidenceId);
  if (!check || check.effect !== 'hold') return;
  const value = decision === 'released' ? 'no' : 'yes';
  yield* writeLabels(
    actor,
    check,
    ['client_name', 'account_details'].map((questionKey) => ({
      questionKey,
      value,
      source: decision === 'released' ? 'hold_released' : 'hold_revised',
      strength: decision === 'released' ? 'gold' : 'weak',
      threshold: check.thresholds['hold'] ?? null,
    })),
    decision === 'released' ? 'admin' : 'author',
  );
});
