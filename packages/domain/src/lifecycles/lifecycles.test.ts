import { describe, expect, it } from 'vitest';
import {
  ALL_LIFECYCLES,
  EngagementLifecycle,
  ObservationLifecycle,
  PlanLifecycle,
  MIN_NARRATIVE_LENGTH,
} from './index.ts';

describe('every lifecycle', () => {
  for (const lifecycle of ALL_LIFECYCLES) {
    describe(`${lifecycle.name}`, () => {
      it('declares exactly the machine’s states', () => {
        expect(Object.keys(lifecycle.machine.config.states ?? {}).toSorted()).toEqual(
          [...lifecycle.states].toSorted(),
        );
      });

      it('declares exactly the events the machine handles', () => {
        const handled = new Set(
          Object.values(lifecycle.machine.config.states ?? {}).flatMap((s) =>
            Object.keys((s as { on?: object }).on ?? {}),
          ),
        );
        expect([...handled].toSorted()).toEqual([...lifecycle.events].toSorted());
      });

      it('marks terminal states final and nothing else', () => {
        const finals = Object.entries(lifecycle.machine.config.states ?? {})
          .filter(([, s]) => (s as { type?: string }).type === 'final')
          .map(([name]) => name)
          .toSorted();
        expect(finals).toEqual([...lifecycle.terminalStates].toSorted());
      });
    });
  }
});

describe('observation', () => {
  const ready = {
    ratingsComplete: true,
    narrativeLength: MIN_NARRATIVE_LENGTH,
    privacyHold: false,
    acknowledged: false,
  };
  const L = ObservationLifecycle;

  it.each([
    ['requested', 'START', 'drafting'],
    ['requested', 'SIGN', 'signed'],
    ['drafting', 'SAVE_DRAFT', 'drafting'],
    ['drafting', 'SIGN', 'signed'],
    ['drafting', 'RETURN', 'returned'],
    ['returned', 'RESUBMIT', 'requested'],
    ['requested', 'EXPIRE', 'expired'],
    ['returned', 'EXPIRE', 'expired'],
    ['signed', 'VOID', 'voided'],
    ['signed', 'ACKNOWLEDGE', 'signed'],
    ['signed', 'REQUEST_REVIEW', 'under_review'],
    ['under_review', 'UPHOLD', 'signed'],
    ['under_review', 'VOID', 'voided'],
  ] as const)('%s --%s--> %s', (from, type, to) => {
    expect(L.next(from, ready, { type })).toBe(to);
  });

  it.each([
    ['signed', 'EXPIRE'],
    ['signed', 'WITHDRAW'],
    ['expired', 'SIGN'],
    ['declined', 'RESUBMIT'],
    ['returned', 'SIGN'],
  ] as const)('rejects %s --%s', (from, type) => {
    expect(L.next(from, ready, { type })).toBeNull();
  });

  it('refuses to sign without complete ratings, a real narrative, or under a privacy hold', () => {
    expect(L.next('drafting', { ...ready, ratingsComplete: false }, { type: 'SIGN' })).toBeNull();
    expect(L.next('drafting', { ...ready, narrativeLength: 4 }, { type: 'SIGN' })).toBeNull();
    expect(L.next('drafting', { ...ready, privacyHold: true }, { type: 'SIGN' })).toBeNull();
  });

  it('lets the subject acknowledge or contest a signed observation once', () => {
    const acknowledged = { ...ready, acknowledged: true };
    expect(L.next('signed', acknowledged, { type: 'ACKNOWLEDGE' })).toBeNull();
    expect(L.next('signed', acknowledged, { type: 'REQUEST_REVIEW' })).toBeNull();
  });

  it('lists only the events allowed in a state', () => {
    const candidates = L.events.map((type) => ({ type }));
    expect(L.allowed('returned', ready, candidates)).toEqual(['RESUBMIT', 'WITHDRAW', 'EXPIRE']);
  });
});

describe('plan', () => {
  it('can be proposed with 1-3 focus skills even before activities are logged', () => {
    const facts = { focusSkillCount: 2, activityCount: 0, endorsed: false };
    expect(PlanLifecycle.next('draft', facts, { type: 'PROPOSE' })).toBe('proposed');
    expect(
      PlanLifecycle.next('draft', { ...facts, focusSkillCount: 4 }, { type: 'PROPOSE' }),
    ).toBeNull();
    expect(
      PlanLifecycle.next('draft', { ...facts, focusSkillCount: 0 }, { type: 'PROPOSE' }),
    ).toBeNull();
  });

  it('accepts one endorsement', () => {
    const facts = { focusSkillCount: 1, activityCount: 1, endorsed: false };
    expect(PlanLifecycle.next('active', facts, { type: 'ENDORSE' })).toBe('active');
    expect(
      PlanLifecycle.next('active', { ...facts, endorsed: true }, { type: 'ENDORSE' }),
    ).toBeNull();
  });
});

describe('engagement', () => {
  it('cannot be accepted when the coach no longer holds the coach grant', () => {
    expect(
      EngagementLifecycle.next('proposed', { coachGrantActive: false }, { type: 'ACCEPT' }),
    ).toBeNull();
    expect(
      EngagementLifecycle.next('proposed', { coachGrantActive: true }, { type: 'ACCEPT' }),
    ).toBe('active');
  });
});
