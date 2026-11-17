/**
 * Gemini Decisions API contracts (model `gemini-decision-1`). Closed-set
 * questions over one shared input; answers are probabilities, never text.
 * Ported from Content Studio's verified integration (its ADR 0029 on the unmerged decisions branch), text input
 * only: this product sends reflections and narratives, never media (ADR 0012).
 */
export const DECISION_MODEL = 'gemini-decision-1';

export const DECISION_LIMITS = {
  maxQuestions: 1000,
  questionKeyPattern: /^[A-Za-z0-9_-]{1,64}$/,
  minOptions: 2,
  maxOptions: 255,
  maxOptionKeyChars: 128,
  minLevels: 2,
  maxLevels: 255,
  maxTextChars: 200_000,
} as const;

/** $0.10 per 1M input tokens, all modalities; no output tokens. */
export const DECISION_PRICE_USD_PER_MILLION_INPUT = 0.1;

export type DecisionQuestion =
  | {
      readonly kind: 'binary';
      readonly instructions: string;
      readonly trueDescription?: string;
      readonly falseDescription?: string;
    }
  | {
      readonly kind: 'choice';
      readonly instructions: string;
      /** option key → description; insertion order is preserved. */
      readonly options: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: 'score';
      readonly instructions: string;
      /** Rubric levels, lowest first. */
      readonly levels: ReadonlyArray<string>;
    };

export interface DecisionRequest {
  readonly input: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
}

export type DecisionAnswer =
  | { readonly kind: 'binary'; readonly probability: number; readonly confidence: number }
  | {
      readonly kind: 'choice';
      readonly choice: string;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    }
  | {
      readonly kind: 'score';
      /** Probability-weighted mean level index (0 = lowest). */
      readonly score: number;
      readonly probabilities: ReadonlyArray<number>;
      readonly confidence: number;
    };

export interface DecisionResult {
  readonly model: string;
  readonly answers: Readonly<Record<string, DecisionAnswer>>;
  /** Asked but not answered. Never treated as a pass. */
  readonly missing: ReadonlyArray<string>;
  /** Answered with the wrong shape. Never coerced. */
  readonly malformed: ReadonlyArray<string>;
  readonly inputTokens: number;
  readonly costUsdMicros: number | null;
  readonly latencyMs: number;
}

export type DecisionsProvider = 'google' | 'mock' | 'disabled';

export interface DecisionsAvailability {
  readonly enabled: boolean;
  readonly provider: DecisionsProvider;
  readonly model: string | null;
}
