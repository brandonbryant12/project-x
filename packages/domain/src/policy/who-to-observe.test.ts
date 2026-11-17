import { describe, expect, it } from 'vitest';
import type { IsoDate, PersonId } from '../ids.ts';
import { whoToObserve, type SupportedPerson } from './who-to-observe.ts';

// I25: who-to-observe follows the fixed priority, honours capacity, never
// suggests the viewer, and never orders people by progress.
const p = (name: string) => `per_${name.padEnd(16, '0')}` as PersonId;
const d = (s: string) => s as IsoDate;
const me = p('sam');
const person = (
  name: string,
  last: string | null,
  observers: ReadonlyArray<PersonId> = [],
): SupportedPerson => ({
  personId: p(name),
  firstName: name[0]!.toUpperCase() + name.slice(1),
  focusSkills: [{ name: 'Client discovery', lastObservedOn: last === null ? null : d(last) }],
  distinctObservers: observers,
});
const base = {
  viewerId: me,
  today: d('2026-11-16'),
  supported: [
    person('ada', '2026-11-10', [me]),
    person('bo', '2026-09-01', [me]),
    person('cy', null),
    person('di', '2026-11-12', [p('leo')]),
  ],
  openRequests: [],
  plannedThisWeek: [],
  capacity: 2,
};

describe('who to observe this week', () => {
  it.each([
    ['capacity 0 turns it off', { capacity: 0 }, []],
    [
      'gaps: never observed, then longest',
      {},
      [
        ['cy', 'longest_unobserved'],
        ['bo', 'longest_unobserved'],
      ],
    ],
    [
      'an open request closing soonest comes first',
      {
        openRequests: [
          { subjectId: p('di'), dueOn: d('2026-11-19') },
          { subjectId: p('ada'), dueOn: d('2026-11-18') },
        ],
      },
      [
        ['ada', 'request_closing'],
        ['di', 'request_closing'],
      ],
    ],
    [
      'planned work this week comes before gaps',
      { plannedThisWeek: [{ subjectId: p('ada'), dueOn: d('2026-11-18') }] },
      [
        ['ada', 'planned_this_week'],
        ['cy', 'longest_unobserved'],
      ],
    ],
    [
      'a second observer is suggested last, and capacity is capped at three',
      { capacity: 9 },
      [
        ['cy', 'longest_unobserved'],
        ['bo', 'longest_unobserved'],
        ['di', 'second_observer'],
      ],
    ],
    [
      'the viewer and duplicates never appear',
      {
        openRequests: [
          { subjectId: me, dueOn: d('2026-11-17') },
          { subjectId: p('cy'), dueOn: d('2026-11-17') },
        ],
      },
      [
        ['cy', 'request_closing'],
        ['bo', 'longest_unobserved'],
      ],
    ],
  ] as const)('%s', (_, overrides, expected) => {
    const result = whoToObserve({ ...base, ...overrides });
    expect(result.map((s) => [s.personId.slice(4).replace(/0+$/, ''), s.reason])).toEqual(expected);
  });

  it('explains each suggestion in a sentence', () => {
    const [first] = whoToObserve({
      ...base,
      openRequests: [{ subjectId: p('ada'), dueOn: d('2026-11-18') }],
    });
    expect(first?.sentence).toBe('Ada asked you to observe; it closes on Wednesday.');
    const [far] = whoToObserve({
      ...base,
      openRequests: [{ subjectId: p('ada'), dueOn: d('2026-11-30') }],
    });
    expect(far?.sentence).toBe('Ada asked you to observe; it closes on Mon, Nov 30.');
  });
});
