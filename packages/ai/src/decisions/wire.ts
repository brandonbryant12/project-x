import { Effect, Option, Schema } from 'effect';
import {
  DECISION_LIMITS,
  type DecisionAnswer,
  type DecisionQuestion,
  type DecisionRequest,
} from './contracts.ts';
import { DecisionsFailed, DecisionsInvalidRequest } from './errors.ts';

const invalid = (rule: string, message: string) => new DecisionsInvalidRequest({ rule, message });

const questionProblem = (key: string, q: DecisionQuestion): DecisionsInvalidRequest | null => {
  if (!DECISION_LIMITS.questionKeyPattern.test(key))
    return invalid('question_key', `Bad key ${key}`);
  if (q.instructions.trim().length === 0)
    return invalid('question_instructions', 'Empty instructions');
  if (q.kind === 'choice') {
    const keys = Object.keys(q.options);
    if (keys.length < DECISION_LIMITS.minOptions || keys.length > DECISION_LIMITS.maxOptions) {
      return invalid('choice_options', 'A choice has too few or too many options');
    }
    if (keys.some((k) => k.length === 0 || k.length > DECISION_LIMITS.maxOptionKeyChars)) {
      return invalid('choice_option_key', 'A choice option key is not valid');
    }
  }
  if (q.kind === 'score') {
    if (
      q.levels.length < DECISION_LIMITS.minLevels ||
      q.levels.length > DECISION_LIMITS.maxLevels
    ) {
      return invalid('score_levels', 'A rubric has too few or too many levels');
    }
    if (q.levels.some((l) => l.trim().length === 0))
      return invalid('score_level_text', 'Empty level');
  }
  return null;
};

/** Enforce documented limits locally; never send a request we know is invalid. */
export const validateDecisionRequest = (
  request: DecisionRequest,
): Effect.Effect<void, DecisionsInvalidRequest> => {
  const keys = Object.keys(request.questions);
  if (keys.length === 0) return Effect.fail(invalid('question_count', 'No questions'));
  if (keys.length > DECISION_LIMITS.maxQuestions) {
    return Effect.fail(invalid('question_count', 'Too many questions'));
  }
  for (const [key, question] of Object.entries(request.questions)) {
    const problem = questionProblem(key, question);
    if (problem) return Effect.fail(problem);
  }
  const chars = request.input.reduce((n, block) => n + block.text.length, 0);
  if (chars === 0) return Effect.fail(invalid('input_empty', 'The shared input is empty'));
  if (chars > DECISION_LIMITS.maxTextChars)
    return Effect.fail(invalid('input_size', 'Input too large'));
  return Effect.void;
};

const encodeQuestion = (q: DecisionQuestion) => {
  switch (q.kind) {
    case 'binary':
      return {
        type: 'noul',
        instructions: q.instructions,
        ...(q.trueDescription || q.falseDescription
          ? {
              criteria: {
                true_description: q.trueDescription ?? '',
                false_description: q.falseDescription ?? '',
              },
            }
          : {}),
      };
    case 'choice':
      return { type: 'choice', instructions: q.instructions, criteria: { ...q.options } };
    case 'score':
      return { type: 'score', instructions: q.instructions, criteria: [...q.levels] };
  }
};

/** The documented REST body. Never logged. */
export const encodeDecisionRequest = (model: string, request: DecisionRequest) => ({
  model,
  input: request.input.map((block) => ({ type: 'text', text: block.text })),
  questions: Object.fromEntries(
    Object.entries(request.questions).map(([key, q]) => [key, encodeQuestion(q)]),
  ),
});

const Probability = Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })));

const WireAnswer = Schema.Union([
  Schema.Struct({ type: Schema.Literal('noul'), noul: Probability, confidence: Probability }),
  Schema.Struct({
    type: Schema.Literal('choice'),
    choice: Schema.String,
    probabilities: Schema.Record(Schema.String, Probability),
    confidence: Probability,
  }),
  Schema.Struct({
    type: Schema.Literal('score'),
    score: Schema.Number,
    probabilities: Schema.Record(Schema.String, Probability),
    confidence: Probability,
  }),
]);
type WireAnswer = typeof WireAnswer.Type;

const WireResponse = Schema.Struct({
  answers: Schema.Record(Schema.String, Schema.Unknown),
  usage: Schema.optional(Schema.Struct({ total_input_tokens: Schema.Number })),
});

const sumsToOne = (values: ReadonlyArray<number>) =>
  Math.abs(values.reduce((t, v) => t + v, 0) - 1) <= 0.02;

/** Map one wire answer onto the question asked; null means malformed. */
const decodeAnswer = (q: DecisionQuestion, wire: WireAnswer): DecisionAnswer | null => {
  if (q.kind === 'binary') {
    return wire.type === 'noul'
      ? { kind: 'binary', probability: wire.noul, confidence: wire.confidence }
      : null;
  }
  if (q.kind === 'choice') {
    if (wire.type !== 'choice') return null;
    const options = Object.keys(q.options);
    const answered = Object.keys(wire.probabilities);
    if (
      !options.includes(wire.choice) ||
      answered.some((o) => !options.includes(o)) ||
      !sumsToOne(Object.values(wire.probabilities))
    ) {
      return null;
    }
    return {
      kind: 'choice',
      choice: wire.choice,
      probabilities: Object.fromEntries(options.map((o) => [o, wire.probabilities[o] ?? 0])),
      confidence: wire.confidence,
    };
  }
  if (wire.type !== 'score') return null;
  const levels = q.levels.length;
  const distribution = Array.from({ length: levels }, (_, i) => wire.probabilities[String(i)] ?? 0);
  const unknownLevel = Object.keys(wire.probabilities).some(
    (l) => !/^\d+$/.test(l) || Number(l) >= levels,
  );
  if (unknownLevel || !sumsToOne(distribution) || wire.score < 0 || wire.score > levels - 1) {
    return null;
  }
  return {
    kind: 'score',
    score: wire.score,
    probabilities: distribution,
    confidence: wire.confidence,
  };
};

export const decodeDecisionResponse = (request: DecisionRequest, body: unknown) =>
  Effect.gen(function* () {
    const response = yield* Schema.decodeUnknownEffect(WireResponse)(body).pipe(
      Effect.mapError(
        () =>
          new DecisionsFailed({
            outcome: 'rejected',
            status: null,
            message: 'The Decisions response did not contain answers',
          }),
      ),
    );
    const answers: Record<string, DecisionAnswer> = {};
    const missing: Array<string> = [];
    const malformed: Array<string> = [];
    for (const [key, question] of Object.entries(request.questions)) {
      const raw = response.answers[key];
      if (raw === undefined || raw === null) {
        missing.push(key);
        continue;
      }
      const wire = Schema.decodeUnknownOption(WireAnswer)(raw);
      const answer = Option.isSome(wire) ? decodeAnswer(question, wire.value) : null;
      if (answer) answers[key] = answer;
      else malformed.push(key);
    }
    return { answers, missing, malformed, inputTokens: response.usage?.total_input_tokens ?? 0 };
  });
