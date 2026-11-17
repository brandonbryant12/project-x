import { describe, expect, it } from 'vitest';
import type { IsoDate, PersonId } from '../ids.ts';
import { whoToObserve, type SupportedPerson } from './who-to-observe.ts';

// I25: who-to-observe follows the fixed priority, shows at most three, never
// suggests the viewer or someone already waiting on them, and never orders
// people by progress.
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
  alreadyWaiting: [],
  plannedThisWeek: [],
};

describe('who to observe this week', () => {
  it.each([
    [
      'gaps (never observed, then longest), then a second observer, at most three',
      {},
      [
        ['cy', 'longest_unobserved'],
        ['bo', 'longest_unobserved'],
        ['di', 'second_observer'],
      ],
    ],
    [
      'planned work this week comes before gaps',
      { plannedThisWeek: [{ subjectId: p('ada'), dueOn: d('2026-11-18') }] },
      [
        ['ada', 'planned_this_week'],
        ['cy', 'longest_unobserved'],
        ['bo', 'longest_unobserved'],
      ],
    ],
    [
      'someone with an open request or draft is not repeated, and neither is the viewer',
      {
        alreadyWaiting: [p('cy'), p('di')],
        plannedThisWeek: [{ subjectId: me, dueOn: d('2026-11-17') }],
      },
      [['bo', 'longest_unobserved']],
    ],
  ] as const)('%s', (_, overrides, expected) => {
    const result = whoToObserve({ ...base, ...overrides });
    expect(result.map((s) => [s.personId.slice(4).replace(/0+$/, ''), s.reason])).toEqual(expected);
  });

  it('explains each suggestion in a sentence', () => {
    const [soon] = whoToObserve({
      ...base,
      plannedThisWeek: [{ subjectId: p('ada'), dueOn: d('2026-11-18') }],
    });
    expect(soon?.sentence).toBe('Ada has work planned on Wednesday with you as observer.');
    const [far] = whoToObserve({
      ...base,
      plannedThisWeek: [{ subjectId: p('ada'), dueOn: d('2026-11-30') }],
    });
    expect(far?.sentence).toBe('Ada has work planned on Mon, Nov 30 with you as observer.');
  });
});
