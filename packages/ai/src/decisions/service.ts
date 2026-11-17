import { Clock, Context, Effect, Layer, Redacted, Schedule, Semaphore } from 'effect';
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http';
import {
  DECISION_MODEL,
  DECISION_PRICE_USD_PER_MILLION_INPUT,
  type DecisionAnswer,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionResult,
  type DecisionsAvailability,
} from './contracts.ts';
import {
  DecisionsDisabled,
  DecisionsFailed,
  DecisionsRateLimited,
  type DecisionsError,
} from './errors.ts';
import { decodeDecisionResponse, encodeDecisionRequest, validateDecisionRequest } from './wire.ts';

export interface DecisionsService {
  readonly availability: DecisionsAvailability;
  readonly evaluate: (request: DecisionRequest) => Effect.Effect<DecisionResult, DecisionsError>;
}

/** Advisory judgments only (ADR 0008). Nothing downstream treats a result as clearance. */
export class Decisions extends Context.Service<Decisions, DecisionsService>()(
  '@repo/ai/Decisions',
) {}

export const layerDisabled = Layer.succeed(
  Decisions,
  Decisions.of({
    availability: { enabled: false, provider: 'disabled', model: null },
    evaluate: () => Effect.fail(new DecisionsDisabled()),
  }),
);

const costMicros = (inputTokens: number) =>
  Math.round(inputTokens * DECISION_PRICE_USD_PER_MILLION_INPUT);

// ─── Google (live) ──────────────────────────────────────────────────────────

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/decisions';
const TIMEOUT = '60 seconds';

export interface GoogleDecisionsOptions {
  readonly apiKey: Redacted.Redacted<string>;
  readonly maxConcurrent?: number;
}

/** Classify an HTTP response: 429 → rate limited; other non-2xx → rejected. */
const responseBody = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<unknown, DecisionsRateLimited | DecisionsFailed> => {
  if (response.status === 429) {
    const retryAfter = Number(response.headers['retry-after']);
    return Effect.fail(
      new DecisionsRateLimited({
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
      }),
    );
  }
  if (response.status < 200 || response.status >= 300) {
    return Effect.fail(
      new DecisionsFailed({
        outcome: 'rejected',
        status: response.status,
        message: `Decisions API returned HTTP ${response.status}`,
      }),
    );
  }
  return Effect.mapError(
    response.json,
    () =>
      new DecisionsFailed({
        outcome: 'unknown',
        status: response.status,
        message: 'Unreadable Decisions response body',
      }),
  );
};

export const layerGoogle = (options: GoogleDecisionsOptions) =>
  Layer.effect(
    Decisions,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const semaphore = yield* Semaphore.make(options.maxConcurrent ?? 4);

      const evaluate = Effect.fn('decisions.evaluate')(function* (request: DecisionRequest) {
        yield* validateDecisionRequest(request);
        const started = yield* Clock.currentTimeMillis;
        const body = yield* semaphore.withPermits(1)(
          HttpClientRequest.post(ENDPOINT).pipe(
            HttpClientRequest.setHeader('x-goog-api-key', Redacted.value(options.apiKey)),
            HttpClientRequest.bodyJsonUnsafe(encodeDecisionRequest(DECISION_MODEL, request)),
            client.execute,
            Effect.mapError(
              (cause) =>
                new DecisionsFailed({ outcome: 'unknown', status: null, message: String(cause) }),
            ),
            Effect.flatMap(responseBody),
            // A timeout may already be billed: report `unknown`, never re-send.
            Effect.timeoutOrElse({
              duration: TIMEOUT,
              orElse: () =>
                Effect.fail(
                  new DecisionsFailed({ outcome: 'unknown', status: null, message: 'Timed out' }),
                ),
            }),
            // Only a confirmed 429 is retried.
            Effect.retry({
              while: (error: DecisionsRateLimited | DecisionsFailed) =>
                error._tag === 'DecisionsRateLimited',
              schedule: Schedule.exponential('500 millis'),
              times: 3,
            }),
          ),
        );
        const decoded = yield* decodeDecisionResponse(request, body);
        const finished = yield* Clock.currentTimeMillis;
        return {
          model: DECISION_MODEL,
          ...decoded,
          costUsdMicros: costMicros(decoded.inputTokens),
          latencyMs: finished - started,
        } satisfies DecisionResult;
      });

      return Decisions.of({
        availability: { enabled: true, provider: 'google', model: DECISION_MODEL },
        evaluate,
      });
    }),
  );

// ─── Mock ───────────────────────────────────────────────────────────────────

/**
 * Domain-specific mock answers, supplied by the caller that owns the question
 * set. Return `undefined` to fall back to the generic word-overlap heuristic.
 */
export type MockRule = (
  key: string,
  question: DecisionQuestion,
  text: string,
) => DecisionAnswer | undefined;

const STOPWORDS = new Set(
  'a an and are as at be by does for from has have in is it of on or that the their this to was were with you your they them he she his her'.split(
    ' ',
  ),
);
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  );

const overlap = (a: string, b: string) => {
  const left = words(a);
  const right = words(b);
  if (left.size === 0) return 0;
  let shared = 0;
  for (const w of left)
    if (right.has(w) || [...right].some((r) => r.startsWith(w.slice(0, 5)))) shared++;
  return shared / left.size;
};

const genericAnswer = (question: DecisionQuestion, text: string): DecisionAnswer => {
  switch (question.kind) {
    case 'binary': {
      const p = Math.min(0.97, Math.max(0.03, overlap(question.instructions, text) * 1.6));
      return { kind: 'binary', probability: Number(p.toFixed(2)), confidence: 0.6 };
    }
    case 'choice': {
      const scores = Object.entries(question.options).map(
        ([key, description]) => [key, overlap(description, text) + 0.01] as const,
      );
      const total = scores.reduce((t, [, s]) => t + s, 0);
      const probabilities = Object.fromEntries(scores.map(([k, s]) => [k, s / total]));
      const choice = scores.toSorted((x, y) => y[1] - x[1])[0]?.[0] ?? '';
      return { kind: 'choice', choice, probabilities, confidence: 0.6 };
    }
    case 'score': {
      const top = question.levels.length - 1;
      const probabilities = question.levels.map((_, i) => (i === top ? 1 : 0));
      return { kind: 'score', score: top, probabilities, confidence: 0.5 };
    }
  }
};

/** Deterministic, offline answers for development, demos and tests. */
export const layerMock = (rules: ReadonlyArray<MockRule> = []) =>
  Layer.succeed(
    Decisions,
    Decisions.of({
      availability: { enabled: true, provider: 'mock', model: 'mock-decision' },
      evaluate: (request) =>
        Effect.gen(function* () {
          yield* validateDecisionRequest(request);
          const text = request.input.map((b) => b.text).join('\n');
          const answers: Record<string, DecisionAnswer> = {};
          for (const [key, question] of Object.entries(request.questions)) {
            answers[key] =
              rules.reduce<DecisionAnswer | undefined>(
                (found, rule) => found ?? rule(key, question, text),
                undefined,
              ) ?? genericAnswer(question, text);
          }
          const inputTokens = Math.ceil(text.length / 4);
          return {
            model: 'mock-decision',
            answers,
            missing: [],
            malformed: [],
            inputTokens,
            costUsdMicros: 0,
            latencyMs: 0,
          } satisfies DecisionResult;
        }).pipe(Effect.withSpan('decisions.evaluate', { attributes: { 'ai.provider': 'mock' } })),
    }),
  );
