import type { DecisionAnswer, DecisionQuestion, MockRule } from '@repo/ai';
import type { QuestionSetId, SkillDefinition, SkillId } from '@repo/domain';

/**
 * Versioned question sets (ADR 0008, ADR 0015). Changing any wording or
 * threshold REQUIRES a version bump; `questions_digest` on each advisory_check
 * proves which exact questions were asked.
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
  readonly appearsToAddress?: ReadonlyArray<string>;
  readonly narrativeParts?: { behavior: boolean; effect: boolean; nextStep: boolean };
  readonly suggestedSkillIds?: ReadonlyArray<SkillId>;
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

// ─── narrative-indicators ───────────────────────────────────────────────────

const indicatorKey = (id: string) => `i_${id.replaceAll(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);

/**
 * Human first (ADR 0016): runs on the OBSERVER's note after they write it,
 * never on the coachee's reflection, and proposes indicators the note appears
 * to describe. The observer confirms with one tap; their choice is the label.
 */
export const narrativeIndicators = {
  id: 'narrative-indicators' as QuestionSetId,
  version: 1,
  indicatorKey,
  build: (definitions: ReadonlyArray<SkillDefinition>): BuiltQuestions => {
    const questions: Record<string, DecisionQuestion> = {};
    for (const definition of definitions) {
      for (const level of definition.levels) {
        for (const indicator of level.indicators) {
          questions[indicatorKey(indicator.id)] = {
            kind: 'binary',
            instructions: `Does this observation note describe the person actually doing this: "${indicator.text}"?`,
          };
        }
      }
    }
    return { questions, thresholds: { addresses: 0.7 } };
  },
  interpret: (
    answers: Readonly<Record<string, DecisionAnswer>>,
    thresholds: Readonly<Record<string, number>>,
    indicatorIds: ReadonlyArray<string>,
  ): Interpretation => {
    const at = thresholds['addresses'] ?? 0.7;
    const addressed = indicatorIds.filter(
      (id) => (probability(answers[indicatorKey(id)]) ?? 0) >= at,
    );
    return {
      effect: 'nudge',
      rationale: `Proposed indicators where the assistant estimated ≥${at} probability that the note describes the behavior.`,
      findings: [
        {
          key: 'indicators',
          label: `Your note appears to describe ${addressed.length} ${addressed.length === 1 ? 'indicator' : 'indicators'}`,
          outcome: addressed.length > 0 ? 'yes' : 'no',
        },
      ],
      appearsToAddress: addressed,
    };
  },
};

// ─── mode-consistency ───────────────────────────────────────────────────────

/** Protects the first-hand criterion: does a "saw it" note read like a debrief? */
export const modeConsistency = {
  id: 'mode-consistency' as QuestionSetId,
  version: 1,
  build: (): BuiltQuestions => ({
    questions: {
      first_hand: {
        kind: 'binary',
        instructions:
          'Does this note describe what the writer personally saw or reviewed, rather than relaying what they were told afterward?',
      },
    },
    thresholds: { relayed_below: 0.3 },
  }),
  interpret: (
    answers: Readonly<Record<string, DecisionAnswer>>,
    thresholds: Readonly<Record<string, number>>,
  ): Interpretation => {
    const p = probability(answers['first_hand']);
    const below = thresholds['relayed_below'] ?? 0.3;
    const relayed = p !== undefined && p < below;
    return {
      effect: relayed ? 'nudge' : 'none',
      rationale: relayed
        ? `The note appears to relay an account (first-hand probability < ${below}).`
        : 'The note reads as first-hand.',
      findings: [
        {
          key: 'first_hand',
          label: relayed ? 'Reads like a debrief' : 'Reads as first-hand',
          outcome: outcomeOf(p, 0.7, below),
        },
      ],
    };
  },
  mockRules: [
    (key, _q, text) =>
      key === 'first_hand'
        ? {
            kind: 'binary',
            probability: /\b(she|he|they) (told|said|mentioned)|\bI heard\b|\baccording to\b/i.test(
              text,
            )
              ? 0.15
              : 0.85,
            confidence: 0.7,
          }
        : undefined,
  ] satisfies ReadonlyArray<MockRule>,
};

// ─── narrative-quality ──────────────────────────────────────────────────────

export const narrativeQuality = {
  id: 'narrative-quality' as QuestionSetId,
  version: 1,
  build: (): BuiltQuestions => ({
    questions: {
      specificity: {
        kind: 'score',
        instructions: 'How specific is this observation of a colleague’s work?',
        levels: [
          'General praise or criticism without describing behavior',
          'Names a specific behavior the person showed',
          'Names a specific behavior, its effect on the client or team, and a next step',
        ],
      },
      behavior: {
        kind: 'binary',
        instructions: 'Does the text describe a specific, observable action the person took?',
      },
      effect: {
        kind: 'binary',
        instructions:
          'Does the text describe the effect that action had on a client, colleague or outcome?',
      },
      next_step: {
        kind: 'binary',
        instructions: 'Does the text suggest a concrete next step for the person?',
      },
    },
    thresholds: { part: 0.6 },
  }),
  interpret: (
    answers: Readonly<Record<string, DecisionAnswer>>,
    thresholds: Readonly<Record<string, number>>,
  ): Interpretation => {
    const at = thresholds['part'] ?? 0.6;
    const parts = {
      behavior: (probability(answers['behavior']) ?? 0) >= at,
      effect: (probability(answers['effect']) ?? 0) >= at,
      nextStep: (probability(answers['next_step']) ?? 0) >= at,
    };
    const generic = !parts.behavior;
    return {
      effect: 'nudge',
      rationale: `Narrative parts present at ≥${at} probability.`,
      findings: [
        {
          key: 'specificity',
          label: generic ? 'Reads as general praise' : 'Names a specific behavior',
          outcome: generic ? 'no' : 'yes',
        },
      ],
      narrativeParts: parts,
    };
  },
  mockRules: [
    (key, _q, text) =>
      key === 'behavior'
        ? {
            kind: 'binary',
            probability:
              /\b(asked|explained|summari[sz]ed|reframed|listened|paused|walked|clarified|named|acknowledged|drew|showed)\b/i.test(
                text,
              )
                ? 0.88
                : 0.12,
            confidence: 0.7,
          }
        : undefined,
    (key, _q, text) =>
      key === 'effect'
        ? {
            kind: 'binary',
            probability:
              /\b(which|so that|led to|as a result|because of that|the client (?:then|visibly)|they (?:relaxed|agreed|opened up))\b/i.test(
                text,
              )
                ? 0.84
                : 0.1,
            confidence: 0.7,
          }
        : undefined,
    (key, _q, text) =>
      key === 'next_step'
        ? {
            kind: 'binary',
            probability: /\b(next time|try|next step|practice|keep doing|consider)\b/i.test(text)
              ? 0.86
              : 0.1,
            confidence: 0.7,
          }
        : undefined,
  ] satisfies ReadonlyArray<MockRule>,
};

// ─── skill-suggest ──────────────────────────────────────────────────────────

export const skillSuggest = {
  id: 'skill-suggest' as QuestionSetId,
  version: 1,
  build: (
    skills: ReadonlyArray<{ id: SkillId; name: string; summary: string }>,
  ): BuiltQuestions => ({
    questions: Object.fromEntries(
      skills.map((s) => [
        `skl_${s.id.slice(4)}`,
        {
          kind: 'binary',
          instructions: `Does this work give the person a chance to show "${s.name}": ${s.summary}?`,
        } satisfies DecisionQuestion,
      ]),
    ),
    thresholds: { suggest: 0.6, max: 3 },
  }),
  interpret: (
    answers: Readonly<Record<string, DecisionAnswer>>,
    thresholds: Readonly<Record<string, number>>,
  ): Interpretation => {
    const at = thresholds['suggest'] ?? 0.6;
    const ranked = Object.entries(answers)
      .flatMap(([key, a]) =>
        a.kind === 'binary' && a.probability >= at
          ? [[`skl_${key.slice(4)}`, a.probability] as const]
          : [],
      )
      .toSorted((x, y) => y[1] - x[1])
      .slice(0, thresholds['max'] ?? 3)
      .map(([id]) => id as SkillId);
    return {
      effect: 'nudge',
      rationale: `Suggested skills where the assistant estimated ≥${at} probability of relevance.`,
      findings: [],
      suggestedSkillIds: ranked,
    };
  },
};

export const ALL_MOCK_RULES: ReadonlyArray<MockRule> = [
  ...privacyScreen.mockRules,
  ...narrativeQuality.mockRules,
  ...modeConsistency.mockRules,
];

/**
 * Shadow arm (ADR 0016): a deterministic slice of checks is computed but never
 * shown, so the human's decision on those subjects is an unbiased label.
 */
export const SHADOW_PERCENT = 15;
export const armFor = (subjectId: string): 'shown' | 'shadow' => {
  let hash = 0;
  for (const char of subjectId) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash % 100 < SHADOW_PERCENT ? 'shadow' : 'shown';
};
