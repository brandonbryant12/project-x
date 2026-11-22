import { describe, expect, it } from 'vitest';
import type { InteractionId, IsoDate, PersonId } from '../ids.ts';
import {
  DEFAULT_BADGE_CRITERIA,
  STRICT_BADGE_CRITERIA,
  evaluateBadge,
  nextBadgeLevel,
  nextStepSentence,
  type CreditFact,
} from './index.ts';

const coach = 'per_coach00000000000' as PersonId;
const leader = 'per_leader0000000000' as PersonId;
const demo = (n: number, overrides: Partial<CreditFact> = {}): CreditFact => ({
  interactionId: `int_${String(n).padEnd(16, '0')}` as InteractionId,
  observerId: coach,
  level: 3,
  mode: 'saw_it',
  demonstratedOn: '2026-09-01' as IsoDate,
  ...overrides,
});

describe('badge criteria (POC defaults)', () => {
  it('is met by two observations with at least one first-hand', () => {
    const credits = [
      demo(1, { demonstratedOn: '2026-09-01' as IsoDate }),
      demo(2, { demonstratedOn: '2026-09-02' as IsoDate, mode: 'discussed' }),
    ];
    const evaluation = evaluateBadge(credits, 3, DEFAULT_BADGE_CRITERIA);
    expect(evaluation.met).toBe(true);
    expect(evaluation.criteria.map((c) => c.key)).toEqual(['demonstrations', 'firstHand']);
  });

  it('requires at least one first-hand observation', () => {
    const credits = [
      demo(1, { mode: 'discussed' }),
      demo(2, { mode: 'discussed', observerId: leader }),
    ];
    const evaluation = evaluateBadge(credits, 3);
    expect(evaluation.met).toBe(false);
    expect(evaluation.criteria.find((c) => c.key === 'firstHand')).toMatchObject({
      current: 0,
      required: 1,
      met: false,
    });
  });

  it('counts an interaction once even when two observers rated it', () => {
    const credits = [demo(1), demo(1, { observerId: leader })];
    expect(evaluateBadge(credits, 2).demonstrations).toBe(1);
  });

  it('ignores demonstrations below the badge level', () => {
    const sentence = nextStepSentence(
      evaluateBadge([demo(1, { level: 2 })], 3),
      'Behavioral coaching',
    );
    expect(sentence).toBe(
      'Be observed two more times at doing independently or above to earn Behavioral coaching · Doing independently.',
    );
  });

  it('targets the lowest badge level not yet held', () => {
    expect(nextBadgeLevel([])).toBe(2);
    expect(nextBadgeLevel([2])).toBe(3);
    expect(nextBadgeLevel([2, 3])).toBeUndefined();
  });
});

describe('badge criteria (strict enterprise policy)', () => {
  it('is never met by one friendly observer in one week, however many demonstrations', () => {
    const credits = [1, 2, 3, 4, 5].map((n) =>
      demo(n, { demonstratedOn: `2026-09-0${n}` as IsoDate }),
    );
    const evaluation = evaluateBadge(credits, 3, STRICT_BADGE_CRITERIA);
    expect(evaluation.met).toBe(false);
    expect(evaluation.criteria.filter((c) => !c.met).map((c) => c.key)).toEqual([
      'observers',
      'span',
    ]);
    expect(nextStepSentence(evaluation, 'Client discovery')).toBe(
      'One more observation from a second observer to earn Client discovery · Doing independently.',
    );
  });

  it('is met by demonstrations at level, two observers, enough first-hand evidence and time', () => {
    const credits = [
      demo(1, { demonstratedOn: '2026-08-01' as IsoDate }),
      demo(2, { demonstratedOn: '2026-08-20' as IsoDate, observerId: leader, mode: 'discussed' }),
      demo(3, { demonstratedOn: '2026-09-02' as IsoDate }),
    ];
    expect(evaluateBadge(credits, 3, STRICT_BADGE_CRITERIA).met).toBe(true);
  });

  it('caps how much a coachee’s own account can count', () => {
    const credits = [1, 2, 3].map((n) =>
      demo(n, {
        mode: 'discussed',
        observerId: n === 1 ? leader : coach,
        demonstratedOn: `2026-0${6 + n}-01` as IsoDate,
      }),
    );
    const evaluation = evaluateBadge(credits, 3, STRICT_BADGE_CRITERIA);
    expect(evaluation.criteria.find((c) => c.key === 'firstHand')).toMatchObject({
      current: 0,
      required: 2,
    });
    expect(nextStepSentence(evaluation, 'Trust')).toBe(
      'Two more observations where your observer saw the work or reviewed it to earn Trust · Doing independently.',
    );
  });
});

describe('first-hand share', () => {
  it('is a share of the demonstrations, not a fixed floor', () => {
    const credits = [
      ...[1, 2].map((n) => demo(n, { demonstratedOn: `2026-07-0${n}` as IsoDate })),
      ...[3, 4, 5, 6, 7, 8].map((n) =>
        demo(n, {
          mode: 'discussed',
          observerId: leader,
          demonstratedOn: `2026-09-0${n}` as IsoDate,
        }),
      ),
    ];
    const firstHand = evaluateBadge(credits, 3).criteria.find((c) => c.key === 'firstHand');
    expect(firstHand).toMatchObject({ current: 2, required: 4, met: false });
  });
});
