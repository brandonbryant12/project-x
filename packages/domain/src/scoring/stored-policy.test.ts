import { describe, expect, it, vi } from 'vitest';
import type * as PolicyModule from './policy.ts';
import type { CreditId, InteractionId, IsoDate, PersonId } from '../ids.ts';
import {
  DEFAULT_CREDIT_POLICY,
  badgeCriteriaFor,
  evaluateBadge,
  readStoredCreditPolicy,
  roleValues,
  type CreditFact,
  type CreditPolicy,
} from './index.ts';

/**
 * Protects "same version, same behavior" (design 2026-11-17 rev. 3, §2): what
 * a tenant's stored policy evaluates to never depends on the code's working
 * defaults. The defaults are replaced by a test double here; a tenant whose
 * stored policy holds other values must evaluate exactly as before.
 */
vi.mock('./policy.ts', async (importOriginal) => {
  const original = await importOriginal<typeof PolicyModule>();
  return {
    ...original,
    DEFAULT_CREDIT_POLICY: {
      ...original.DEFAULT_CREDIT_POLICY,
      primaryPoints: 1,
      secondaryPoints: 1,
      badgePoints: 999,
      minInteractions: 9,
      minObservers: 9,
      minSpanDays: 900,
    },
  };
});

const stored: CreditPolicy = {
  version: 3,
  primaryPoints: 10,
  secondaryPoints: 3,
  badgePoints: 30,
  minInteractions: 3,
  minObservers: 2,
  minFirstHandShare: 0.5,
  minSpanDays: 28,
  minPrimaryPoints: 0,
  maxSkillsPerObservation: 3,
  activityOverrides: { enabled: true, minPoints: 1, maxPoints: 20 },
};

const credit = (n: number, observerId: string): CreditFact => ({
  id: `crd_${String(n).padStart(16, '0')}` as CreditId,
  interactionId: `int_${String(n).padStart(16, '0')}` as InteractionId,
  observerId: observerId as PersonId,
  level: 3,
  mode: 'saw_it',
  demonstratedOn: `2026-0${n + 1}-01` as IsoDate,
  points: 10,
  role: 'primary',
});

describe('a stored policy does not depend on the working defaults', () => {
  it('evaluates the same when the defaults change', () => {
    expect(DEFAULT_CREDIT_POLICY.badgePoints).toBe(999);
    const reading = readStoredCreditPolicy(stored);
    if (!reading.ok) throw new Error('stored policy should be valid');
    expect(reading.policy).toEqual(stored);
    const ledger = [credit(1, 'per_a'), credit(2, 'per_b'), credit(3, 'per_a')];
    expect(evaluateBadge(ledger, 3, badgeCriteriaFor(reading.policy)).met).toBe(true);
    expect(roleValues(reading.policy)).toEqual({ primary: 10, secondary: 3 });
  });
});
