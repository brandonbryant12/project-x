import { describe, expect, it } from 'vitest';
import type { CreditId, InteractionId, IsoDate, PersonId, SkillId } from '../ids.ts';
import type { BadgeLevel } from '../vocabulary.ts';
import {
  DEFAULT_BADGE_CRITERIA,
  DEFAULT_CREDIT_POLICY,
  badgeCriteriaFor,
  creditPolicyVersion,
  criteriaFromSnapshot,
  evaluateBadge,
  nextBadgeLevel,
  nextStepSentence,
  projectWork,
  replaceCreditPolicy,
  resolveCreditPolicy,
  resolveCreditValue,
  resolveRatingRoles,
  roleValues,
  validateCreditPolicy,
  type BadgeCriteria,
  type CreditFact,
} from './index.ts';

/**
 * Protects the weighted credit rules (design 2026-11-17 rev. 2, §2, §4, §5):
 * what a credit is worth, which role a rated skill takes, the one projection of
 * credits onto points, and when points, pieces of work, observers, first-hand
 * points and time earn a badge. Also proves legacy equivalence: with every
 * credit worth 10, N pieces of work and 10N points needed, the rule decides
 * exactly as the old N-demonstration rule did.
 */
const coach = 'per_coach00000000000' as PersonId;
const leader = 'per_leader0000000000' as PersonId;
const peer = 'per_peer000000000000' as PersonId;
const work = (n: number) => `int_${String(n).padStart(16, '0')}` as InteractionId;
const day = (offset: number) =>
  new Date(Date.UTC(2026, 6, 1) + offset * 86_400_000).toISOString().slice(0, 10) as IsoDate;

let seq = 0;
const credit = (n: number, overrides: Partial<CreditFact> = {}): CreditFact => ({
  id: `crd_${String(++seq).padStart(16, '0')}` as CreditId,
  interactionId: work(n),
  observerId: coach,
  level: 3,
  mode: 'saw_it',
  demonstratedOn: day(n * 10),
  points: 10,
  role: 'primary',
  ...overrides,
});

const criteria = (overrides: Partial<BadgeCriteria> = {}): BadgeCriteria => ({
  ...DEFAULT_BADGE_CRITERIA,
  ...overrides,
});

const measured = (credits: ReadonlyArray<CreditFact>, level: BadgeLevel, c = criteria()) => {
  const evaluation = evaluateBadge(credits, level, c);
  return {
    met: evaluation.met,
    points: evaluation.points,
    unmet: evaluation.criteria.filter((x) => !x.met).map((x) => x.key),
  };
};

const criterionKeys = (c: BadgeCriteria) =>
  evaluateBadge([credit(1)], 3, c).criteria.map((x) => x.key);
const firstHandOf = (credits: ReadonlyArray<CreditFact>) =>
  evaluateBadge(credits, 3).criteria.find((c) => c.key === 'firstHand');

/** The rule before points (scoring/2026-11-16.2), kept here as the oracle. */
const oldRuleMet = (credits: ReadonlyArray<CreditFact>, level: BadgeLevel, n: number) => {
  const atLevel = credits.filter((c) => c.level >= level);
  const demonstrations = new Set(atLevel.map((c) => c.interactionId)).size;
  const observers = new Set(atLevel.map((c) => c.observerId)).size;
  const firstHand = new Set(
    atLevel.filter((c) => c.mode !== 'discussed').map((c) => c.interactionId),
  ).size;
  const needed = Math.max(1, Math.ceil(Math.max(demonstrations, n) * 0.5));
  const dates = atLevel.map((c) => Date.parse(c.demonstratedOn)).toSorted((a, b) => a - b);
  const span = dates.length ? Math.round(((dates.at(-1) ?? 0) - (dates[0] ?? 0)) / 86_400_000) : 0;
  return demonstrations >= n && observers >= 2 && firstHand >= needed && span >= 28;
};

const onActivity = (
  role: 'primary' | 'secondary',
  pointsOverride: number | null,
  templatePoints: number | null,
) => ({
  role,
  pointsOverride,
  templatePoints,
});

describe('one piece of work counts once per skill (the projection)', () => {
  it.each([
    {
      rule: 'two observers of one piece of work never add points twice',
      credits: [credit(1), credit(1, { observerId: leader })],
      points: 10,
      demonstrations: 1,
    },
    {
      rule: 'the highest value wins over a second observer’s lower one',
      credits: [credit(1, { points: 3, role: 'secondary' }), credit(1, { observerId: leader })],
      points: 10,
      demonstrations: 1,
    },
    {
      rule: 'after the higher credit is reversed, the remaining one still counts',
      credits: [credit(1, { points: 3, role: 'secondary' })],
      points: 3,
      demonstrations: 1,
    },
    {
      rule: 'separate pieces of work add up',
      credits: [credit(1), credit(2, { points: 3, role: 'secondary' }), credit(3, { points: 15 })],
      points: 28,
      demonstrations: 3,
    },
  ])('$rule', ({ credits, points, demonstrations }) => {
    const evaluation = evaluateBadge(credits, 3);
    expect(evaluation.points).toBe(points);
    expect(evaluation.demonstrations).toBe(demonstrations);
  });

  it('computes value, first-hand value and primary value independently', () => {
    const discussedHigh = credit(1, { points: 12, role: 'secondary', mode: 'discussed' });
    const sawPrimary = credit(1, { observerId: leader, points: 10 });
    const [only] = projectWork([discussedHigh, sawPrimary]);
    expect(only).toMatchObject({
      value: 12,
      firstHandValue: 10,
      primaryValue: 10,
      countedCreditId: discussedHigh.id,
    });
    expect(only?.creditIds).toEqual([discussedHigh.id, sawPrimary.id]);
  });

  it('marks the primary credit as counted when two credits tie', () => {
    const secondary = credit(1, { role: 'secondary' });
    const primary = credit(1, { observerId: leader });
    expect(projectWork([secondary, primary])[0]?.countedCreditId).toBe(primary.id);
  });
});

describe('badge criteria', () => {
  const twoObserversOverTime = (overrides: Partial<CreditFact> = {}) => [
    credit(1, overrides),
    credit(2, { ...overrides, observerId: leader }),
    credit(4, overrides),
  ];
  const tenSecondary = () =>
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
      credit(n, { points: 3, role: 'secondary', observerId: n % 2 ? coach : leader }),
    );

  it.each([
    {
      rule: 'is met by enough points and work, two observers, first-hand points and time',
      credits: twoObserversOverTime(),
      c: criteria(),
      result: { met: true, points: 30, unmet: [] },
    },
    {
      rule: 'is earned from secondary credits only when they reach the points',
      credits: tenSecondary(),
      c: criteria(),
      result: { met: true, points: 30, unmet: [] },
    },
    {
      rule: 'with minimum primary points on, secondary-only credit is not enough',
      credits: tenSecondary(),
      c: criteria({ minPrimaryPoints: 10 }),
      result: { met: false, points: 30, unmet: ['primaryPoints'] },
    },
    {
      rule: 'with minimum primary points on, one primary piece of work satisfies it',
      credits: [
        credit(1),
        ...[2, 3, 4, 5, 6, 7, 8].map((n) =>
          credit(n, { points: 3, role: 'secondary', observerId: leader }),
        ),
      ],
      c: criteria({ minPrimaryPoints: 10 }),
      result: { met: true, points: 31, unmet: [] },
    },
    {
      rule: 'a secondary credit that outranks a primary one never hides it from primary points',
      credits: [
        credit(1, { points: 15, role: 'secondary' }),
        credit(1, { observerId: leader, points: 10 }),
        credit(2, { observerId: leader }),
        credit(4),
      ],
      c: criteria({ minPrimaryPoints: 30 }),
      result: { met: true, points: 35, unmet: [] },
    },
    {
      rule: 'two big pieces of work never earn a badge that needs three',
      credits: [credit(1, { points: 20 }), credit(4, { points: 20, observerId: leader })],
      c: criteria(),
      result: { met: false, points: 40, unmet: ['interactions'] },
    },
    {
      rule: 'is never met by one friendly observer in one week, however many points',
      credits: [1, 2, 3, 4, 5].map((n) => credit(n, { demonstratedOn: day(n) })),
      c: criteria(),
      result: { met: false, points: 50, unmet: ['observers', 'span'] },
    },
  ])('$rule', ({ credits, c, result }) => {
    expect(measured(credits, 3, c)).toEqual(result);
  });

  it('only shows the primary-points criterion when the policy or skill turns it on', () => {
    expect(criterionKeys(criteria())).toEqual([
      'points',
      'interactions',
      'observers',
      'firstHand',
      'span',
    ]);
    expect(criterionKeys(criteria({ minPrimaryPoints: 5 }))).toContain('primaryPoints');
    const fromSkill = badgeCriteriaFor(DEFAULT_CREDIT_POLICY, {
      badgePoints: 40,
      minPrimaryPoints: 20,
    });
    expect(fromSkill).toMatchObject({ badgePoints: 40, minPrimaryPoints: 20 });
  });

  it('keeps only credits at or above the level when observers disagree on level', () => {
    const credits = [
      credit(1, { level: 2 }),
      credit(1, { observerId: leader, level: 3, points: 3, role: 'secondary' }),
      credit(2, { level: 2, observerId: leader }),
    ];
    // Level 3: only the leader's lower-valued credit on work 1 counts.
    expect(evaluateBadge(credits, 3)).toMatchObject({ points: 3, demonstrations: 1 });
    // Level 2: both pieces of work, each once at its highest value.
    expect(evaluateBadge(credits, 2)).toMatchObject({ points: 20, demonstrations: 2 });
    const observers = evaluateBadge(credits, 3).criteria.find((c) => c.key === 'observers');
    expect(observers?.current).toBe(1);
  });

  it('weighs first-hand by points against a stable target, counting each piece of work once', () => {
    // Three first-hand credits on one piece of work count once: 10 of the 15 needed (half of 30).
    expect(
      firstHandOf([
        credit(1),
        credit(1, { observerId: leader }),
        credit(1, { observerId: peer }),
        ...[2, 3].map((n) => credit(n, { mode: 'discussed', observerId: leader })),
      ]),
    ).toMatchObject({ current: 10, required: 15, met: false });
    // A high-value discussed credit raises the target instead of lowering it: half of 60.
    expect(
      firstHandOf([credit(1), credit(2, { mode: 'discussed', points: 50, observerId: leader })]),
    ).toMatchObject({ current: 10, required: 30, met: false });
  });

  it('targets the lowest badge level not yet held', () => {
    expect(nextBadgeLevel([])).toBe(2);
    expect(nextBadgeLevel([2])).toBe(3);
    expect(nextBadgeLevel([2, 3])).toBeUndefined();
  });
});

describe('legacy equivalence', () => {
  const oldCases: ReadonlyArray<ReadonlyArray<CreditFact>> = [
    [1, 2, 3, 4, 5].map((n) => credit(n, { demonstratedOn: day(n) })),
    [credit(1), credit(2, { observerId: leader, mode: 'discussed' }), credit(4)],
    [credit(1), credit(2, { observerId: leader }), credit(3, { mode: 'discussed' }), credit(5)],
    [credit(1), credit(1, { observerId: leader })],
    [1, 2, 3].map((n) => credit(n, { mode: 'discussed', observerId: n === 1 ? leader : coach })),
    [credit(1, { level: 2 })],
    [
      credit(1),
      credit(2),
      ...[3, 4, 5, 6, 7, 8].map((n) => credit(n, { mode: 'discussed', observerId: leader })),
    ],
  ];

  /** Deterministic pseudo-random ledgers, every credit worth 10 as legacy credits are. */
  const generated = Array.from({ length: 400 }, (_, seed) => {
    let state = seed * 7919 + 17;
    const next = (n: number) => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state % n;
    };
    return Array.from({ length: 1 + next(8) }, () =>
      credit(1 + next(6), {
        observerId: [coach, leader, peer][next(3)] as PersonId,
        level: (1 + next(4)) as CreditFact['level'],
        mode: (['saw_it', 'reviewed_work', 'discussed'] as const)[next(3)] as CreditFact['mode'],
      }),
    );
  });

  it.each([
    [2, 3],
    [3, 3],
    [3, 4],
  ] as const)(
    'with credits worth 10, level %i under %i demonstrations decides as the old rule did',
    (level, n) => {
      const legacy = criteriaFromSnapshot({
        minDemonstrations: n,
        minObservers: 2,
        minFirstHandShare: 0.5,
        minSpanDays: 28,
      });
      const decisions = [...oldCases, ...generated].map((credits) => [
        evaluateBadge(credits, level, legacy).met,
        oldRuleMet(credits, level, n),
      ]);
      expect(decisions.filter(([now, before]) => now !== before)).toEqual([]);
      // The cases are not trivial: both outcomes occur.
      expect(new Set(decisions.map(([now]) => now)).size).toBe(2);
    },
  );

  it('reads a legacy award snapshot as N pieces of work and N × 10 points', () => {
    expect(
      criteriaFromSnapshot({
        minDemonstrations: 4,
        minObservers: 3,
        minFirstHandShare: 0.6,
        minSpanDays: 14,
      }),
    ).toEqual({
      badgePoints: 40,
      minInteractions: 4,
      minObservers: 3,
      minFirstHandShare: 0.6,
      minSpanDays: 14,
      minPrimaryPoints: 0,
    });
    const saved = badgeCriteriaFor(DEFAULT_CREDIT_POLICY, {
      badgePoints: 50,
      minPrimaryPoints: null,
    });
    expect(criteriaFromSnapshot({ ...saved })).toEqual(saved);
  });
});

describe('what a credit is worth', () => {
  const policy = DEFAULT_CREDIT_POLICY;
  const skill = { primaryPoints: 12, secondaryPoints: 4 };
  it.each([
    {
      rule: 'the activity’s own value wins',
      input: { role: 'primary', activity: onActivity('primary', 15, 8), skill },
      value: { points: 15, source: 'activity' },
    },
    {
      rule: 'the activity’s own value applies whatever the credit’s role',
      input: { role: 'secondary', activity: onActivity('primary', 15, 8), skill },
      value: { points: 15, source: 'activity' },
    },
    {
      rule: 'the activity’s value stays inside the tenant’s range',
      input: { role: 'primary', activity: onActivity('primary', 500, null) },
      value: { points: 20, source: 'activity' },
    },
    {
      rule: 'then the template value copied onto the activity, for the same role',
      input: { role: 'primary', activity: onActivity('primary', null, 8), skill },
      value: { points: 8, source: 'template' },
    },
    {
      rule: 'the copied template value does not apply to a credit in another role',
      input: { role: 'secondary', activity: onActivity('primary', null, 8), skill },
      value: { points: 4, source: 'skill' },
    },
    {
      rule: 'then the skill’s value for the role',
      input: { role: 'primary', activity: onActivity('primary', null, null), skill },
      value: { points: 12, source: 'skill' },
    },
    {
      rule: 'then the tenant’s value for the role',
      input: { role: 'secondary' },
      value: { points: 3, source: 'tenant' },
    },
  ] as const)('$rule', ({ input, value }) => {
    expect(resolveCreditValue({ policy, ...input })).toEqual(value);
  });

  it('ignores an activity’s own value while the tenant does not allow them', () => {
    const closed = resolveCreditPolicy({
      ...DEFAULT_CREDIT_POLICY,
      activityOverrides: { enabled: false, minPoints: 1, maxPoints: 20 },
    });
    expect(
      resolveCreditValue({
        policy: closed,
        role: 'primary',
        activity: onActivity('primary', 15, null),
      }),
    ).toEqual({ points: 10, source: 'tenant' });
  });

  it('tells a person what one observation is worth by role', () => {
    expect(roleValues(policy, { primaryPoints: null, secondaryPoints: 5 })).toEqual({
      primary: 10,
      secondary: 5,
    });
  });
});

describe('which role a rated skill takes (the observer owns it)', () => {
  const a = 'skl_a000000000000000' as SkillId;
  const b = 'skl_b000000000000000' as SkillId;
  const c = 'skl_c000000000000000' as SkillId;
  const listed = [
    { skillId: a, role: 'primary' },
    { skillId: b, role: 'secondary' },
  ] as const;
  it.each([
    {
      rule: 'a new observation takes the activity’s roles',
      activity: listed,
      ratings: [{ skillId: b }, { skillId: a }],
      result: { ok: true, roles: ['secondary', 'primary'] },
    },
    {
      rule: 'a skill the activity does not list defaults to secondary',
      activity: [{ skillId: a, role: 'primary' }],
      ratings: [{ skillId: a }, { skillId: c }],
      result: { ok: true, roles: ['primary', 'secondary'] },
    },
    {
      rule: 'with no primary among the rated skills, the first becomes primary',
      activity: [],
      ratings: [{ skillId: a }, { skillId: b }],
      result: { ok: true, roles: ['primary', 'secondary'] },
    },
    {
      rule: 'the observer’s choice wins over the activity',
      activity: listed,
      ratings: [
        { skillId: a, chosen: 'secondary' },
        { skillId: b, chosen: 'primary' },
      ],
      result: { ok: true, roles: ['secondary', 'primary'] },
    },
    {
      rule: 'the stored role wins over a later change to the activity',
      activity: [
        { skillId: a, role: 'secondary' },
        { skillId: b, role: 'primary' },
      ],
      ratings: [
        { skillId: a, stored: 'primary' },
        { skillId: b, stored: 'secondary' },
      ],
      result: { ok: true, roles: ['primary', 'secondary'] },
    },
    {
      rule: 'a chosen primary demotes a stored one',
      activity: listed,
      ratings: [
        { skillId: a, stored: 'primary' },
        { skillId: b, stored: 'secondary', chosen: 'primary' },
      ],
      result: { ok: true, roles: ['secondary', 'primary'] },
    },
    {
      rule: 'the observer may mark no skill as primary',
      activity: listed,
      ratings: [
        { skillId: a, chosen: 'secondary' },
        { skillId: b, chosen: 'secondary' },
      ],
      result: { ok: true, roles: ['secondary', 'secondary'] },
    },
    {
      rule: 'two chosen primaries are refused',
      activity: [],
      ratings: [
        { skillId: a, chosen: 'primary' },
        { skillId: b, chosen: 'primary' },
      ],
      result: { ok: false, reason: 'two_primaries' },
    },
  ] as const)('$rule', ({ activity, ratings, result }) => {
    expect(resolveRatingRoles(activity, ratings)).toEqual(result);
  });
});

describe('credit policy', () => {
  it('merges a stored policy over the working defaults, defensively', () => {
    expect(resolveCreditPolicy({ version: 4, badgePoints: 40 })).toEqual({
      ...DEFAULT_CREDIT_POLICY,
      version: 4,
      badgePoints: 40,
    });
    expect(resolveCreditPolicy(undefined)).toEqual(DEFAULT_CREDIT_POLICY);
  });

  it.each([
    { field: 'primaryPoints', stored: { primaryPoints: 0 } },
    { field: 'primaryPoints', stored: { primaryPoints: 2.5 } },
    { field: 'badgePoints', stored: { badgePoints: 100_001 } },
    { field: 'minInteractions', stored: { minInteractions: 1 } },
    { field: 'minObservers', stored: { minObservers: 1 } },
    { field: 'minObservers', stored: { minObservers: 11 } },
    { field: 'minFirstHandShare', stored: { minFirstHandShare: 1.5 } },
    { field: 'minSpanDays', stored: { minSpanDays: 0 } },
    { field: 'minPrimaryPoints', stored: { minPrimaryPoints: 31 } },
    { field: 'maxSkillsPerObservation', stored: { maxSkillsPerObservation: 7 } },
    {
      field: 'activityOverrides.maxPoints',
      stored: { activityOverrides: { enabled: true, minPoints: 10, maxPoints: 5 } },
    },
  ] as const)(
    'refuses $field out of range, and falls back to its default when read',
    ({ field, stored }) => {
      const merged = {
        ...DEFAULT_CREDIT_POLICY,
        ...stored,
        activityOverrides: {
          ...DEFAULT_CREDIT_POLICY.activityOverrides,
          ...('activityOverrides' in stored ? stored.activityOverrides : {}),
        },
      };
      expect(validateCreditPolicy(merged).map((p) => p.field)).toEqual([field]);
      expect(validateCreditPolicy(resolveCreditPolicy(stored))).toEqual([]);
    },
  );

  it('allows secondary points above primary points', () => {
    expect(
      validateCreditPolicy({ ...DEFAULT_CREDIT_POLICY, primaryPoints: 3, secondaryPoints: 10 }),
    ).toEqual([]);
  });

  it('replaces a policy only from the version the editor saw, bumping it', () => {
    const { version: _, ...proposed } = { ...DEFAULT_CREDIT_POLICY, badgePoints: 40 };
    expect(replaceCreditPolicy(DEFAULT_CREDIT_POLICY, 1, proposed)).toEqual({
      ok: true,
      policy: { ...proposed, version: 2 },
    });
    expect(replaceCreditPolicy({ ...DEFAULT_CREDIT_POLICY, version: 2 }, 1, proposed)).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(
      replaceCreditPolicy(DEFAULT_CREDIT_POLICY, 1, { ...proposed, minObservers: 1 }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('composes the version recorded on credits and awards', () => {
    expect(creditPolicyVersion({ version: 3 })).toMatch(/^scoring\/\d{4}-\d{2}-\d{2}\.\d+#3$/);
  });
});

describe('the next step, in plain words', () => {
  it.each([
    {
      rule: 'a points gap is said in points and observations',
      credits: [credit(1)],
      c: criteria(),
      values: { primary: 10, secondary: 3 },
      sentence:
        '20 more points at doing independently or above to earn Client discovery · Doing independently, about two more observations with Client discovery as the main skill.',
    },
    {
      rule: 'without role values it says points only',
      credits: [credit(1), credit(2, { points: 15 })],
      c: criteria(),
      values: undefined,
      sentence:
        'Five more points at doing independently or above to earn Client discovery · Doing independently.',
    },
    {
      rule: 'enough points from too few pieces of work asks for more observations',
      credits: [credit(1, { points: 20 }), credit(4, { points: 20, observerId: leader })],
      c: criteria(),
      values: undefined,
      sentence:
        'Be observed one more time at doing independently or above to earn Client discovery · Doing independently.',
    },
    {
      rule: 'a missing primary share names the main skill',
      credits: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
        credit(n, { points: 3, role: 'secondary', observerId: n % 2 ? coach : leader }),
      ),
      c: criteria({ minPrimaryPoints: 10 }),
      values: undefined,
      sentence:
        '10 more points from work where Client discovery is the main skill to earn Client discovery · Doing independently.',
    },
    {
      rule: 'then a second observer',
      credits: [1, 2, 3, 4].map((n) => credit(n)),
      c: criteria(),
      values: undefined,
      sentence:
        'One more observation from a second observer to earn Client discovery · Doing independently.',
    },
    {
      rule: 'met but not yet awarded (a loosened policy) says when it is awarded',
      credits: [credit(1), credit(2, { observerId: leader }), credit(4)],
      c: criteria(),
      values: undefined,
      sentence:
        "You've met every criterion for Client discovery · Doing independently. It is awarded with your next signed observation of Client discovery.",
    },
  ])('$rule', ({ credits, c, values, sentence }) => {
    expect(nextStepSentence(evaluateBadge(credits, 3, c), 'Client discovery', values)).toBe(
      sentence,
    );
  });
});
