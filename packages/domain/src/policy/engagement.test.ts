import { describe, expect, it } from 'vitest';
import type { IsoDate, PersonId } from '../ids.ts';
import {
  checkEngagementProposal,
  proposableDirections,
  type LiveEngagement,
  type RelationshipFacts,
} from './index.ts';

// Coaching proposals (invariants.md, number assigned on merge): a proposal is possible only toward someone holding the coach
// grant, never from a leader to their own direct report, never to oneself, and
// never while the pair has a live engagement in either direction. The profile
// offers exactly the directions that pass.

const p = (name: string) => `per_${name.padEnd(16, '0')}` as PersonId;
const d = (s: string) => s as IsoDate;

// On 2026-06-01:
//   rhea → leo → ada, cole;  rhea → sam, jo
//   coach grants: sam, jo, cole, leo; kit's grant ended 2026-05-01
const rhea = p('rhea');
const leo = p('leo');
const ada = p('ada');
const cole = p('cole');
const sam = p('sam');
const jo = p('jo');
const kit = p('kit');
const zed = p('zed');
const on = d('2026-06-01');

const facts: RelationshipFacts = {
  reportingLines: [
    { managerId: rhea, reportId: leo, from: d('2025-01-01'), to: null },
    { managerId: leo, reportId: ada, from: d('2025-01-01'), to: null },
    { managerId: leo, reportId: cole, from: d('2025-01-01'), to: null },
    { managerId: rhea, reportId: sam, from: d('2025-01-01'), to: null },
    { managerId: rhea, reportId: jo, from: d('2025-01-01'), to: null },
  ],
  engagements: [],
  coachGrants: [
    { personId: sam, from: d('2025-01-01'), to: null },
    { personId: jo, from: d('2025-01-01'), to: null },
    { personId: cole, from: d('2025-01-01'), to: null },
    { personId: leo, from: d('2025-01-01'), to: null },
    { personId: kit, from: d('2025-01-01'), to: d('2026-05-01') },
  ],
};

describe('coaching proposals', () => {
  const none: ReadonlyArray<LiveEngagement> = [];
  it.each([
    ['a coach coaches a colleague', sam, ada, none, { ok: true }],
    ['a report who is a coach coaches their leader', cole, leo, none, { ok: true }],
    ['someone coaches themselves', sam, sam, none, { ok: false, reason: 'self' }],
    ['the coach holds no grant', ada, zed, none, { ok: false, reason: 'not_a_coach' }],
    ['the coach grant has ended', kit, ada, none, { ok: false, reason: 'not_a_coach' }],
    ['a leader coaches their own report', leo, ada, none, { ok: false, reason: 'leads_coachee' }],
    [
      'the pair is already engaged this way',
      sam,
      jo,
      [{ coachId: sam, coacheeId: jo }],
      { ok: false, reason: 'already_engaged' },
    ],
    [
      'the pair is already engaged the other way',
      sam,
      jo,
      [{ coachId: jo, coacheeId: sam }],
      { ok: false, reason: 'already_engaged' },
    ],
  ] as const)('%s', (_, coachId, coacheeId, live, expected) => {
    expect(checkEngagementProposal(facts, { coachId, coacheeId, on, live })).toEqual(expected);
  });

  it.each([
    ['coach to coach: both directions', sam, jo, none, ['coach_them', 'coach_me']],
    ['not a coach, to a coach: only being coached', ada, sam, none, ['coach_me']],
    ['a coach, to someone who is not: only coaching them', sam, ada, none, ['coach_them']],
    ['neither is a coach: nothing', ada, zed, none, []],
    ['a leader who coaches, to their own report: nothing', leo, ada, none, []],
    [
      'a leader who coaches, to their report who coaches: only being coached',
      leo,
      cole,
      none,
      ['coach_me'],
    ],
    ['coaches already engaged: nothing', jo, sam, [{ coachId: sam, coacheeId: jo }], []],
    ['yourself: nothing', sam, sam, none, []],
  ] as const)('%s', (_, viewerId, otherId, live, expected) => {
    expect(proposableDirections(facts, { viewerId, otherId, on, live })).toEqual(expected);
  });
});
