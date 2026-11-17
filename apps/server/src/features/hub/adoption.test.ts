import { describe, expect, it } from 'vitest';
import { coverageFigures } from '../shared/program.ts';
import { timingFigures } from './adoption.ts';

/**
 * Adoption suppression (ADR 0021), the rules a journey cannot reach with the
 * seeded world's handful of people: a figure needs at least five distinct
 * people (never five events), "with a plan" is suppressed like any other
 * figure, and "observed" is withheld when the group it leaves out is small
 * enough to read off by subtraction.
 */
describe('coverage figures', () => {
  it.each([
    { withPlan: 4, observed: 0, shown: { withPlan: null, observed: null } },
    { withPlan: 4, observed: 4, shown: { withPlan: null, observed: null } },
    { withPlan: 12, observed: 3, shown: { withPlan: 12, observed: null } },
    // 12 - 8 = 4 people with a plan were not observed: a group under five.
    { withPlan: 12, observed: 8, shown: { withPlan: 12, observed: null } },
    // Everyone was observed: the complement is empty, so each person's status is known.
    { withPlan: 12, observed: 12, shown: { withPlan: 12, observed: null } },
    { withPlan: 12, observed: 7, shown: { withPlan: 12, observed: 7 } },
    { withPlan: 10, observed: 5, shown: { withPlan: 10, observed: 5 } },
  ])('$withPlan with a plan, $observed observed', ({ withPlan, observed, shown }) => {
    expect(coverageFigures(withPlan, observed)).toEqual(shown);
  });
});

describe('timing figures count people, not events', () => {
  const at = new Date('2026-11-16T15:00:00Z');
  const loggedAt = new Date('2026-11-02T15:00:00Z');
  const signedBy = (people: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      subjectId: `per_${i % people}`,
      loggedAt,
      signedAt: new Date(loggedAt.getTime() + (i + 1) * 86_400_000),
    }));
  const closedBy = (people: number, count: number, expired: number) =>
    Array.from({ length: count }, (_, i) => ({
      subjectId: `per_${i % people}`,
      status: i < expired ? 'expired' : 'signed',
      dueAt: new Date(at.getTime() - 86_400_000),
    }));

  it('withholds both figures when many observations come from few people', () => {
    expect(timingFigures({ signed: signedBy(2, 12), requested: closedBy(4, 20, 5) }, at)).toEqual({
      medianDaysToSign: null,
      expiryRate: null,
    });
  });

  it('shows both once five distinct people stand behind them', () => {
    expect(timingFigures({ signed: signedBy(5, 5), requested: closedBy(5, 10, 2) }, at)).toEqual({
      medianDaysToSign: 3,
      expiryRate: 0.2,
    });
  });

  it('counts only requests whose window has closed toward the expiry rate', () => {
    const open = closedBy(5, 5, 0).map((r) => ({ ...r, dueAt: new Date(at.getTime() + 1) }));
    expect(
      timingFigures({ signed: [], requested: [...closedBy(4, 8, 1), ...open] }, at).expiryRate,
    ).toBeNull();
  });
});
