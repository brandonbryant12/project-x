import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { DecisionRequest } from './contracts.ts';
import { Decisions, layerDisabled, layerMock } from './service.ts';
import { decodeDecisionResponse, validateDecisionRequest } from './wire.ts';

/**
 * Protects the AI system card's failure-handling claims (ADR 0008):
 * invalid requests are never sent; missing and malformed answers are reported,
 * never coerced into a pass; a disabled provider fails loudly.
 */
const request: DecisionRequest = {
  input: [
    { type: 'text', text: 'Asked what a good retirement would feel like before any numbers.' },
  ],
  questions: {
    behavior: { kind: 'binary', instructions: 'Does the note describe a specific behavior?' },
    mode: {
      kind: 'choice',
      instructions: 'How was it observed?',
      options: { saw: 'Saw it', told: 'Was told' },
    },
    depth: {
      kind: 'score',
      instructions: 'How specific is it?',
      levels: ['Generic', 'Specific', 'Specific with effect'],
    },
  },
};

describe('Decisions wire contract', () => {
  it.effect('refuses to send requests that break documented limits', () =>
    Effect.gen(function* () {
      const empty = yield* validateDecisionRequest({
        ...request,
        input: [{ type: 'text', text: '' }],
      }).pipe(Effect.flip);
      assert.strictEqual(empty.rule, 'input_empty');
      const badKey = yield* validateDecisionRequest({
        ...request,
        questions: { 'bad key!': request.questions['behavior']! },
      }).pipe(Effect.flip);
      assert.strictEqual(badKey.rule, 'question_key');
      const oneOption = yield* validateDecisionRequest({
        ...request,
        questions: { mode: { kind: 'choice', instructions: 'x', options: { only: 'One' } } },
      }).pipe(Effect.flip);
      assert.strictEqual(oneOption.rule, 'choice_options');
    }),
  );

  it.effect('reports missing and malformed answers per question instead of coercing them', () =>
    Effect.gen(function* () {
      const decoded = yield* decodeDecisionResponse(request, {
        answers: {
          behavior: { type: 'noul', noul: 0.91, confidence: 0.8 },
          // Wrong shape for a choice question, and probabilities that do not sum to one.
          mode: {
            type: 'choice',
            choice: 'saw',
            probabilities: { saw: 0.9, told: 0.5 },
            confidence: 0.7,
          },
        },
        usage: { total_input_tokens: 120 },
      });
      assert.deepStrictEqual(Object.keys(decoded.answers), ['behavior']);
      assert.deepStrictEqual(decoded.malformed, ['mode']);
      assert.deepStrictEqual(decoded.missing, ['depth']);
      assert.strictEqual(decoded.inputTokens, 120);
    }),
  );

  it.effect('treats a response without answers as a failure, never a pass', () =>
    Effect.gen(function* () {
      const error = yield* decodeDecisionResponse(request, { candidates: [] }).pipe(Effect.flip);
      assert.strictEqual(error._tag, 'DecisionsFailed');
    }),
  );
});

describe('Decisions providers', () => {
  it.effect('disabled provider fails with DecisionsDisabled', () =>
    Effect.gen(function* () {
      const decisions = yield* Decisions;
      assert.isFalse(decisions.availability.enabled);
      const error = yield* decisions.evaluate(request).pipe(Effect.flip);
      assert.strictEqual(error._tag, 'DecisionsDisabled');
    }).pipe(Effect.provide(layerDisabled)),
  );

  it.effect('mock provider answers every question deterministically and lets rules override', () =>
    Effect.gen(function* () {
      const decisions = yield* Decisions;
      const first = yield* decisions.evaluate(request);
      const second = yield* decisions.evaluate(request);
      assert.deepStrictEqual(first.answers, second.answers);
      assert.deepStrictEqual(Object.keys(first.answers).toSorted(), ['behavior', 'depth', 'mode']);
      assert.deepStrictEqual(first.answers['behavior'], {
        kind: 'binary',
        probability: 0.99,
        confidence: 1,
      });
    }).pipe(
      Effect.provide(
        layerMock([
          (key) =>
            key === 'behavior' ? { kind: 'binary', probability: 0.99, confidence: 1 } : undefined,
        ]),
      ),
    ),
  );
});
