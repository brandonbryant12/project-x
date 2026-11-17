import { describe, expect, it } from 'vitest';
import type { IsoDate, PersonId } from '../ids.ts';
import {
  canReadNarrative,
  checkDesignation,
  checkObserverEligibility,
  developmentAccess,
  eligibleObserversOf,
  leaderChainOf,
  type RelationshipFacts,
} from './index.ts';

const p = (name: string) => `per_${name.padEnd(16, '0')}` as PersonId;
const d = (s: string) => s as IsoDate;

// Org on 2026-06-01:
//   rhea (exec) → leo (leader) → ada (advisor), cole (coach)
//   cole coaches ada (accepted 2026-03-01) and leo (accepted 2026-05-01)
//   ada's line moved from mona to leo on 2026-04-01
const rhea = p('rhea');
const leo = p('leo');
const mona = p('mona');
const ada = p('ada');
const cole = p('cole');
const zed = p('zed');

const facts: RelationshipFacts = {
  reportingLines: [
    { managerId: rhea, reportId: leo, from: d('2025-01-01'), to: null },
    { managerId: mona, reportId: ada, from: d('2025-01-01'), to: d('2026-04-01') },
    { managerId: leo, reportId: ada, from: d('2026-04-01'), to: null },
    { managerId: leo, reportId: cole, from: d('2025-01-01'), to: null },
  ],
  engagements: [
    { coachId: cole, coacheeId: ada, from: d('2026-03-01'), to: null },
    { coachId: cole, coacheeId: leo, from: d('2026-05-01'), to: null },
  ],
  coachGrants: [{ personId: cole, from: d('2025-01-01'), to: null }],
};

describe('observer eligibility', () => {
  const on = d('2026-06-01');

  it('allows the direct leader and an engaged coach, with their basis', () => {
    expect(checkObserverEligibility(facts, { observerId: leo, subjectId: ada, on })).toEqual({
      eligible: true,
      basis: 'leader',
    });
    expect(checkObserverEligibility(facts, { observerId: cole, subjectId: ada, on })).toEqual({
      eligible: true,
      basis: 'coach',
    });
  });

  it('never allows self-observation', () => {
    expect(checkObserverEligibility(facts, { observerId: ada, subjectId: ada, on })).toMatchObject({
      reason: 'self',
    });
  });

  it('does not let skip-level leaders or strangers credit', () => {
    expect(checkObserverEligibility(facts, { observerId: rhea, subjectId: ada, on })).toMatchObject(
      {
        reason: 'no_relationship',
      },
    );
    expect(checkObserverEligibility(facts, { observerId: zed, subjectId: ada, on })).toMatchObject({
      reason: 'no_relationship',
    });
  });

  it('blocks a coach who reports to the subject from crediting them', () => {
    // cole coaches leo but reports to leo.
    expect(checkObserverEligibility(facts, { observerId: cole, subjectId: leo, on })).toMatchObject(
      {
        reason: 'reports_to_subject',
      },
    );
  });

  it('evaluates as of the interaction date', () => {
    const march = d('2026-03-15');
    expect(
      checkObserverEligibility(facts, { observerId: mona, subjectId: ada, on: march }),
    ).toMatchObject({
      basis: 'leader',
    });
    expect(
      checkObserverEligibility(facts, { observerId: leo, subjectId: ada, on: march }),
    ).toMatchObject({
      reason: 'no_relationship',
    });
    // Before the engagement was accepted.
    expect(
      checkObserverEligibility(facts, { observerId: cole, subjectId: ada, on: d('2026-02-01') }),
    ).toMatchObject({ reason: 'no_relationship' });
  });

  it('stops counting a coach whose grant has ended', () => {
    const lapsed: RelationshipFacts = {
      ...facts,
      coachGrants: [{ personId: cole, from: d('2025-01-01'), to: d('2026-05-15') }],
    };
    expect(
      checkObserverEligibility(lapsed, { observerId: cole, subjectId: ada, on }),
    ).toMatchObject({
      reason: 'no_relationship',
    });
  });

  it('lists eligible observers', () => {
    expect(eligibleObserversOf(facts, ada, on)).toEqual(
      expect.arrayContaining([
        { personId: cole, basis: 'coach' },
        { personId: leo, basis: 'leader' },
      ]),
    );
    // cole coaches leo but reports to him, so only rhea (leo's leader) qualifies.
    expect(eligibleObserversOf(facts, leo, on)).toEqual([{ personId: rhea, basis: 'leader' }]);
  });
});

describe('development visibility', () => {
  const on = d('2026-06-01');

  it('shows development to self, coaches and the whole leader chain only', () => {
    expect(developmentAccess(facts, { viewerId: ada, subjectId: ada, on })).toBe('self');
    expect(developmentAccess(facts, { viewerId: cole, subjectId: ada, on })).toBe('coach');
    expect(developmentAccess(facts, { viewerId: leo, subjectId: ada, on })).toBe('leader');
    expect(developmentAccess(facts, { viewerId: rhea, subjectId: ada, on })).toBe('leader');
    expect(developmentAccess(facts, { viewerId: mona, subjectId: ada, on })).toBe('none');
  });

  it('survives cycles in directory data', () => {
    const cyclic: RelationshipFacts = {
      ...facts,
      reportingLines: [
        { managerId: ada, reportId: leo, from: d('2025-01-01'), to: null },
        { managerId: leo, reportId: ada, from: d('2025-01-01'), to: null },
      ],
    };
    expect(leaderChainOf(cyclic, ada, on)).toEqual([leo]);
  });
});

describe('narrative visibility', () => {
  const on = d('2026-06-01');
  it('limits narratives to subject, observer, coaches and the direct leader', () => {
    const read = (viewerId: PersonId) =>
      canReadNarrative(facts, { viewerId, subjectId: ada, observerId: cole, on });
    expect([ada, cole, leo, rhea, zed].map(read)).toEqual([true, true, true, false, false]);
  });
});

// I21 (ADR 0020): a designated observer is eligible only inside the window, and
// designations cannot be self, reciprocal, overlapping, or longer than 90 days.
describe('designated observers', () => {
  const kim = p('kim');
  const withKim: RelationshipFacts = {
    ...facts,
    reportingLines: [
      ...facts.reportingLines,
      { managerId: leo, reportId: kim, from: d('2025-01-01'), to: null },
    ],
    designations: [{ observerId: kim, subjectId: ada, from: d('2026-06-01'), to: d('2026-07-01') }],
  };

  it.each([
    ['inside the window', '2026-06-10', { eligible: true, basis: 'designated' }],
    ['before it starts', '2026-05-31', { eligible: false, reason: 'no_relationship' }],
    ['on the end date (half-open)', '2026-07-01', { eligible: false, reason: 'no_relationship' }],
  ])('a designee %s', (_, on, expected) => {
    expect(
      checkObserverEligibility(withKim, { observerId: kim, subjectId: ada, on: d(on) }),
    ).toEqual(expected);
  });

  const window = { from: d('2026-08-01'), to: d('2026-09-01') };
  it.each([
    [
      'the leader designates a peer',
      leo,
      kim,
      ada,
      window,
      { ok: true, designatorBasis: 'leader' },
    ],
    ['the coach designates a peer', cole, kim, ada, window, { ok: true, designatorBasis: 'coach' }],
    ['a peer designates', kim, zed, ada, window, { ok: false, reason: 'not_leader_or_coach' }],
    ['the subject is the designee', leo, ada, ada, window, { ok: false, reason: 'self' }],
    [
      'the designator names themselves',
      leo,
      leo,
      ada,
      window,
      { ok: false, reason: 'designator_is_observer' },
    ],
    [
      'the designee reports to the subject',
      rhea,
      cole,
      leo,
      window,
      { ok: false, reason: 'reports_to_subject' },
    ],
    [
      'the window is over 90 days',
      leo,
      kim,
      ada,
      { from: d('2026-08-01'), to: d('2026-11-01') },
      { ok: false, reason: 'bad_window' },
    ],
    [
      'the window overlaps an existing one',
      leo,
      kim,
      ada,
      { from: d('2026-06-20'), to: d('2026-07-20') },
      { ok: false, reason: 'overlaps_existing' },
    ],
    [
      'the reverse pair overlaps (anti-collusion)',
      leo,
      ada,
      kim,
      { from: d('2026-06-20'), to: d('2026-07-20') },
      { ok: false, reason: 'overlaps_existing' },
    ],
  ] as const)('%s', (_, designatorId, observerId, subjectId, w, expected) => {
    expect(checkDesignation(withKim, { designatorId, observerId, subjectId, ...w })).toEqual(
      expected,
    );
  });
});
