import { Decisions, type DecisionResult, type DecisionsError } from '@repo/ai';
import type { Actor } from '@repo/api';
import { AdvisoryCheckId, type QuestionSetId, type TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { recordAdvisoryCheck } from '../../../platform/metrics.ts';
import { now } from '../../../platform/time.ts';
import type { BuiltQuestions, Interpretation } from './question-sets.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export type CheckOutcome =
  | {
      readonly status: 'completed';
      readonly id: AdvisoryCheckId;
      readonly interpretation: Interpretation;
    }
  | { readonly status: 'failed' | 'skipped'; readonly id: AdvisoryCheckId };

export interface CheckRequest {
  readonly actor: Pick<Actor, 'tenantId'> & { readonly tenantId: TenantId };
  readonly questionSet: { readonly id: QuestionSetId; readonly version: number };
  readonly built: BuiltQuestions;
  readonly subjectType: string;
  readonly subjectId: string;
  /** The subject row's version when its text was read (stale checks never apply). */
  readonly subjectVersion: number;
  readonly text: string;
  readonly interpret: (result: DecisionResult) => Interpretation;
}

/**
 * Runs one advisory check and writes its explainable decision record
 * (ADR 0015). Never inside a DB transaction; never logs the input text.
 * Failures are recorded as `failed` and never treated as a pass.
 */
export const runCheck = Effect.fn('advisory.check')(function* (request: CheckRequest) {
  const db = yield* Db;
  const decisions = yield* Decisions;
  const id = AdvisoryCheckId.generate();
  const questionsDigest = sha256(JSON.stringify(request.built.questions));
  const base = {
    id,
    tenantId: request.actor.tenantId,
    questionSet: request.questionSet.id,
    questionSetVersion: request.questionSet.version,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    subjectVersion: request.subjectVersion,
    provider: decisions.availability.provider,
    model: decisions.availability.model,
    inputDigest: sha256(request.text),
    questionsDigest,
    thresholds: request.built.thresholds,
  };
  yield* Effect.annotateCurrentSpan({
    'ai.question_set': request.questionSet.id,
    'ai.provider': decisions.availability.provider,
  });

  if (!decisions.availability.enabled || Object.keys(request.built.questions).length === 0) {
    yield* db.insert(schema.advisoryCheck).values({
      ...base,
      status: 'skipped',
      rationale: decisions.availability.enabled
        ? 'Nothing to evaluate.'
        : 'Assistant checks are turned off.',
      completedAt: yield* now,
    });
    yield* recordAdvisoryCheck({
      questionSet: request.questionSet.id,
      provider: decisions.availability.provider,
      status: 'skipped',
      effect: 'none',
    });
    return { status: 'skipped', id } satisfies CheckOutcome as CheckOutcome;
  }

  yield* db.insert(schema.advisoryCheck).values({ ...base, status: 'pending' });
  const evaluated = yield* decisions
    .evaluate({ input: [{ type: 'text', text: request.text }], questions: request.built.questions })
    .pipe(
      Effect.map((result) => ({ ok: true as const, result })),
      Effect.catch((error: DecisionsError) => Effect.succeed({ ok: false as const, error })),
    );
  const completedAt = yield* now;

  if (!evaluated.ok) {
    yield* db
      .update(schema.advisoryCheck)
      .set({
        status: 'failed',
        failure: `${evaluated.error._tag}${'outcome' in evaluated.error ? `:${evaluated.error.outcome}` : ''}`,
        rationale: 'Assistant check unavailable; nothing was inferred.',
        completedAt,
      })
      .where(eq(schema.advisoryCheck.id, id));
    yield* Effect.logWarning('advisory check failed', {
      questionSet: request.questionSet.id,
      error: evaluated.error._tag,
    });
    yield* recordAdvisoryCheck({
      questionSet: request.questionSet.id,
      provider: decisions.availability.provider,
      status: 'failed',
      effect: 'none',
    });
    return { status: 'failed', id } satisfies CheckOutcome as CheckOutcome;
  }

  const { result } = evaluated;
  const interpretation = request.interpret(result);
  yield* db
    .update(schema.advisoryCheck)
    .set({
      status: 'completed',
      answers: {
        answers: result.answers,
        missing: result.missing,
        malformed: result.malformed,
        inputTokens: result.inputTokens,
      },
      result: interpretation,
      effect: interpretation.effect,
      inputTokens: result.inputTokens,
      rationale: interpretation.rationale,
      costUsdMicros: result.costUsdMicros,
      latencyMs: result.latencyMs,
      completedAt,
    })
    .where(eq(schema.advisoryCheck.id, id));
  yield* recordAdvisoryCheck({
    questionSet: request.questionSet.id,
    provider: decisions.availability.provider,
    status: 'completed',
    effect: interpretation.effect,
    latencyMs: result.latencyMs,
  });
  return { status: 'completed', id, interpretation } satisfies CheckOutcome as CheckOutcome;
});
