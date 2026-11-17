import type { IsoDate, PersonId } from '../ids.ts';

/**
 * "Who to observe this week" (path-to-A § 2). A short list with a reason each,
 * in a fixed priority. It is never a ranking of people by progress: everyone
 * else stays behind "everyone you support", sorted by name.
 *
 * Priority:
 *  1. an open request to the viewer, closing soonest;
 *  2. planned work this week that names the viewer as observer;
 *  3. the longest time since anyone observed one of the person's focus skills;
 *  4. the person has exactly one distinct observer, and it is not the viewer.
 */
export type ObserveReason =
  | 'request_closing'
  | 'planned_this_week'
  | 'longest_unobserved'
  | 'second_observer';

export interface SupportedPerson {
  readonly personId: PersonId;
  readonly firstName: string;
  /** Last observation date per focus skill (null: never observed). */
  readonly focusSkills: ReadonlyArray<{
    readonly name: string;
    readonly lastObservedOn: IsoDate | null;
  }>;
  readonly distinctObservers: ReadonlyArray<PersonId>;
}

export interface ObserveInputs {
  readonly viewerId: PersonId;
  readonly today: IsoDate;
  /** People the viewer can observe today (leader, coach or designated). */
  readonly supported: ReadonlyArray<SupportedPerson>;
  readonly openRequests: ReadonlyArray<{ readonly subjectId: PersonId; readonly dueOn: IsoDate }>;
  readonly plannedThisWeek: ReadonlyArray<{
    readonly subjectId: PersonId;
    readonly dueOn: IsoDate;
  }>;
  /** Self-set; 0 turns the suggestions off. */
  readonly capacity: number;
}

export interface ObserveSuggestion {
  readonly personId: PersonId;
  readonly reason: ObserveReason;
  readonly sentence: string;
}

/** The list never grows past three, whatever the capacity. */
export const MAX_OBSERVE_SUGGESTIONS = 3;

const daysSince = (from: IsoDate, to: IsoDate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** "today", "tomorrow", or the weekday name. */
const when = (iso: IsoDate, today: IsoDate) => {
  const ahead = daysSince(today, iso);
  if (ahead <= 0) return 'today';
  if (ahead === 1) return 'tomorrow';
  const date = new Date(`${iso}T12:00:00Z`);
  // Within a week a weekday is unambiguous; beyond it, name the date.
  return ahead <= 6
    ? `on ${date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}`
    : `on ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
};

export const whoToObserve = (input: ObserveInputs): ReadonlyArray<ObserveSuggestion> => {
  const limit = Math.min(Math.max(input.capacity, 0), MAX_OBSERVE_SUGGESTIONS);
  if (limit === 0) return [];
  const byId = new Map(input.supported.map((p) => [p.personId, p]));
  const chosen = new Map<PersonId, ObserveSuggestion>();
  const add = (s: ObserveSuggestion) => {
    if (chosen.size < limit && !chosen.has(s.personId) && s.personId !== input.viewerId) {
      chosen.set(s.personId, s);
    }
  };

  for (const r of input.openRequests.toSorted((a, b) => a.dueOn.localeCompare(b.dueOn))) {
    const name = byId.get(r.subjectId)?.firstName ?? 'Someone';
    add({
      personId: r.subjectId,
      reason: 'request_closing',
      sentence: `${name} asked you to observe; it closes ${when(r.dueOn, input.today)}.`,
    });
  }
  for (const p of input.plannedThisWeek.toSorted((a, b) => a.dueOn.localeCompare(b.dueOn))) {
    const name = byId.get(p.subjectId)?.firstName;
    if (!name) continue;
    add({
      personId: p.subjectId,
      reason: 'planned_this_week',
      sentence: `${name} has work planned ${when(p.dueOn, input.today)} with you as observer.`,
    });
  }
  const gaps = input.supported
    .flatMap((person) =>
      person.focusSkills.map((skill) => ({
        person,
        skill,
        gap:
          skill.lastObservedOn === null
            ? Number.POSITIVE_INFINITY
            : daysSince(skill.lastObservedOn, input.today),
      })),
    )
    .filter((g) => g.gap >= 21)
    // Longest gap first; ties by name so the order is stable, never by progress.
    .toSorted((a, b) => b.gap - a.gap || a.person.firstName.localeCompare(b.person.firstName));
  for (const g of gaps) {
    add({
      personId: g.person.personId,
      reason: 'longest_unobserved',
      sentence:
        g.skill.lastObservedOn === null
          ? `Nobody has observed ${g.person.firstName}'s ${g.skill.name} yet.`
          : `Nobody has observed ${g.person.firstName}'s ${g.skill.name} for ${Math.floor(g.gap / 7)} weeks.`,
    });
  }
  for (const person of input.supported.toSorted((a, b) => a.firstName.localeCompare(b.firstName))) {
    if (
      person.distinctObservers.length === 1 &&
      !person.distinctObservers.includes(input.viewerId)
    ) {
      add({
        personId: person.personId,
        reason: 'second_observer',
        sentence: `You would be ${person.firstName}'s second observer.`,
      });
    }
  }
  return [...chosen.values()];
};
