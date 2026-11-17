import type { DecisionAnswer, DecisionQuestion, MockRule } from '@repo/ai';
import type { QuestionSetId } from '@repo/domain';

/**
 * Versioned question sets (ADR 0008, ADR 0015). Changing any wording or
 * threshold REQUIRES a version bump; `questions_digest` on each advisory_check
 * proves which exact questions were asked.
 *
 * Only the privacy screen runs. The nudge sets (narrative indicators and
 * quality, mode consistency, skill suggestions) are parked with the learning
 * loop until live use is cleared (ADR 0016, deferred); git history has them.
 */
export interface Finding {
  readonly key: string;
  readonly label: string;
  readonly outcome: 'yes' | 'no' | 'unclear';
}

export interface Interpretation {
  readonly effect: 'hold' | 'escalate' | 'nudge' | 'none';
  readonly rationale: string;
  readonly findings: ReadonlyArray<Finding>;
}

export interface BuiltQuestions {
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
  readonly thresholds: Readonly<Record<string, number>>;
}

const probability = (answer: DecisionAnswer | undefined): number | undefined =>
  answer?.kind === 'binary' ? answer.probability : undefined;

const outcomeOf = (p: number | undefined, yesAt: number, noBelow = 0.2): Finding['outcome'] => {
  if (p === undefined) return 'unclear';
  if (p >= yesAt) return 'yes';
  return p < noBelow ? 'no' : 'unclear';
};

// ─── privacy-screen ─────────────────────────────────────────────────────────

export const privacyScreen = {
  id: 'privacy-screen' as QuestionSetId,
  version: 1,
  maxEffect: 'hold' as const,
  build: (): BuiltQuestions => ({
    questions: {
      client_name: {
        kind: 'binary',
        instructions:
          'Does the text contain the name of a client, prospect or their family member (not the employee or colleagues)?',
      },
      account_details: {
        kind: 'binary',
        instructions:
          'Does the text contain an account number, government ID, date of birth, address or other identifying details about a client?',
      },
      security_recommendation: {
        kind: 'binary',
        instructions:
          'Does the text describe a specific security, trade or product recommendation made to a client?',
      },
      complaint: {
        kind: 'binary',
        instructions: 'Does the text describe a client complaint or dissatisfaction with the firm?',
      },
    },
    thresholds: { hold: 0.8, flag: 0.7 },
  }),
  interpret: (
    answers: Readonly<Record<string, DecisionAnswer>>,
    thresholds: Readonly<Record<string, number>>,
  ): Interpretation => {
    const hold = thresholds['hold'] ?? 0.8;
    const flag = thresholds['flag'] ?? 0.7;
    const findings: Array<Finding> = [
      {
        key: 'client_name',
        label: 'Client names',
        outcome: outcomeOf(probability(answers['client_name']), hold),
      },
      {
        key: 'account_details',
        label: 'Account or identity details',
        outcome: outcomeOf(probability(answers['account_details']), hold),
      },
      {
        key: 'security_recommendation',
        label: 'Specific recommendations',
        outcome: outcomeOf(probability(answers['security_recommendation']), flag),
      },
      {
        key: 'complaint',
        label: 'Client complaint',
        outcome: outcomeOf(probability(answers['complaint']), flag),
      },
    ];
    const holding = findings.filter(
      (f) => (f.key === 'client_name' || f.key === 'account_details') && f.outcome === 'yes',
    );
    const flagged = findings.filter(
      (f) => (f.key === 'security_recommendation' || f.key === 'complaint') && f.outcome === 'yes',
    );
    if (holding.length > 0) {
      return {
        effect: 'hold',
        rationale: `Held: the assistant estimated ≥${hold} probability of ${holding.map((f) => f.label.toLowerCase()).join(' and ')}.`,
        findings,
      };
    }
    if (flagged.length > 0) {
      return {
        effect: 'escalate',
        rationale: `Escalated to compliance: ${flagged.map((f) => f.label.toLowerCase()).join(' and ')} (≥${flag}). Not something to edit away.`,
        findings,
      };
    }
    return { effect: 'none', rationale: 'No privacy concerns met the hold threshold.', findings };
  },
  mockRules: [
    (key, _q, text) =>
      key === 'client_name'
        ? {
            kind: 'binary',
            probability: /\b(?:Mr|Mrs|Ms|Dr)\.?\s+[A-Z]|\bthe [A-Z][a-z]+s\b/.test(text)
              ? 0.92
              : 0.04,
            confidence: 0.8,
          }
        : undefined,
    (key, _q, text) =>
      key === 'account_details'
        ? {
            kind: 'binary',
            probability: /\d{6,}|account (?:number|#)/i.test(text) ? 0.9 : 0.03,
            confidence: 0.8,
          }
        : undefined,
    (key, _q, text) =>
      key === 'complaint'
        ? {
            kind: 'binary',
            probability: /complain|unhappy|frustrat|upset with (?:us|the firm)/i.test(text)
              ? 0.85
              : 0.05,
            confidence: 0.7,
          }
        : undefined,
    (key, _q, text) =>
      key === 'security_recommendation'
        ? {
            kind: 'binary',
            probability: /\b(?:buy|sell|recommend(?:ed)? (?:the|a) [A-Z]{2,5})\b/i.test(text)
              ? 0.75
              : 0.06,
            confidence: 0.7,
          }
        : undefined,
  ] satisfies ReadonlyArray<MockRule>,
};

export const ALL_MOCK_RULES: ReadonlyArray<MockRule> = [...privacyScreen.mockRules];
