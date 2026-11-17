import type { CreditPolicyValues, StoredCreditPolicy } from '@repo/api';
import { validateCreditPolicy, type PolicyProblem } from '@repo/domain';

/**
 * The credit rules form, field by field: what each value means in the words
 * the calculation actually uses (design 2026-11-17 §2, §5). Kept beside the
 * form so the copy and the arithmetic cannot drift apart.
 */
export type PolicyField =
  | Exclude<keyof CreditPolicyValues, 'activityOverrides'>
  | 'activityOverrides.minPoints'
  | 'activityOverrides.maxPoints';

export interface FieldSpec {
  readonly field: PolicyField;
  readonly label: string;
  readonly hint: string;
  /** Shown after the input, e.g. "points". */
  readonly unit: string;
  /** The share is edited as a percentage. */
  readonly percent?: boolean;
}

export const WORTH: ReadonlyArray<FieldSpec> = [
  {
    field: 'primaryPoints',
    label: 'Primary skill',
    unit: 'points',
    hint: 'What one signed observation earns for the skill the work was mainly about. A skill, a template or an activity can set its own value instead.',
  },
  {
    field: 'secondaryPoints',
    label: 'Secondary skill',
    unit: 'points',
    hint: 'What it earns for each other skill the observer rated in the same work.',
  },
  {
    field: 'maxSkillsPerObservation',
    label: 'Skills on one observation',
    unit: 'at most',
    hint: 'How many skills an observer can rate in one observation, up to 6.',
  },
];

export const BADGE: ReadonlyArray<FieldSpec> = [
  {
    field: 'badgePoints',
    label: 'Points for a badge',
    unit: 'points',
    hint: 'Points are summed once per piece of work: when several observers sign the same work, it counts once, at its highest value. A skill can set its own total.',
  },
  {
    field: 'minInteractions',
    label: 'Pieces of work',
    unit: 'at least',
    hint: 'Different pieces of work observed at the badge’s level or above.',
  },
  {
    field: 'minObservers',
    label: 'Observers',
    unit: 'at least',
    hint: 'Different people who signed observations of that work.',
  },
  {
    field: 'minFirstHandShare',
    label: 'Seen first-hand',
    unit: '% of the work',
    percent: true,
    hint: 'A share of the pieces of work, not of points: that share must have been seen or reviewed by the observer, not only discussed. It is counted against the larger of the work observed and the pieces of work required, and is never fewer than one.',
  },
  {
    field: 'minSpanDays',
    label: 'Spread over',
    unit: 'days',
    hint: 'Days between the first and the last piece of work.',
  },
  {
    field: 'minPrimaryPoints',
    label: 'Points from primary work',
    unit: 'points',
    hint: '0 turns this off. Above 0, that many of the badge’s points must come from work where the skill was primary. Credit observed before roles existed never counts here. A skill can set its own minimum.',
  },
];

export const OVERRIDE_RANGE: ReadonlyArray<FieldSpec> = [
  {
    field: 'activityOverrides.minPoints',
    label: 'Lowest activity value',
    unit: 'points',
    hint: 'The lowest value one activity may be given.',
  },
  {
    field: 'activityOverrides.maxPoints',
    label: 'Highest activity value',
    unit: 'points',
    hint: 'The highest. An activity value outside the range in force when its work is signed is ignored, never adjusted.',
  },
];

export const ALL_FIELDS = [...WORTH, ...BADGE, ...OVERRIDE_RANGE];

/** The form's text for every number, plus the switch. */
export interface PolicyForm {
  readonly values: Readonly<Record<PolicyField, string>>;
  readonly overridesEnabled: boolean | null;
}

/** One field's value from a stored or complete policy (null when missing). */
export const valueOf = (stored: StoredCreditPolicy | CreditPolicyValues, field: PolicyField) => {
  if (field === 'activityOverrides.minPoints') return stored.activityOverrides.minPoints ?? null;
  if (field === 'activityOverrides.maxPoints') return stored.activityOverrides.maxPoints ?? null;
  return stored[field] ?? null;
};

const yesNo = (value: boolean | null) => {
  if (value === null) return 'not set';
  return value ? 'yes' : 'no';
};

const spec = (field: PolicyField) => ALL_FIELDS.find((f) => f.field === field);

/** A stored value as the form shows it (a share as a percentage); a missing value is empty. */
export const display = (field: PolicyField, value: number | null): string => {
  if (value === null) return '';
  return spec(field)?.percent ? String(Math.round(value * 1000) / 10) : String(value);
};

export const formFrom = (stored: StoredCreditPolicy | CreditPolicyValues): PolicyForm => ({
  values: Object.fromEntries(
    ALL_FIELDS.map((f) => [f.field, display(f.field, valueOf(stored, f.field))]),
  ) as Record<PolicyField, string>,
  overridesEnabled: stored.activityOverrides.enabled,
});

const number = (field: PolicyField, text: string) => {
  const t = text.trim();
  if (t === '') return Number.NaN;
  const n = Number(t);
  return spec(field)?.percent ? n / 100 : n;
};

/** The complete policy the form describes; empty or invalid inputs stay invalid (never defaulted). */
export const policyFrom = (form: PolicyForm): CreditPolicyValues => {
  const v = (field: PolicyField) => number(field, form.values[field]);
  return {
    primaryPoints: v('primaryPoints'),
    secondaryPoints: v('secondaryPoints'),
    badgePoints: v('badgePoints'),
    minInteractions: v('minInteractions'),
    minObservers: v('minObservers'),
    minFirstHandShare: v('minFirstHandShare'),
    minSpanDays: v('minSpanDays'),
    minPrimaryPoints: v('minPrimaryPoints'),
    maxSkillsPerObservation: v('maxSkillsPerObservation'),
    activityOverrides: {
      enabled: form.overridesEnabled as boolean,
      minPoints: v('activityOverrides.minPoints'),
      maxPoints: v('activityOverrides.maxPoints'),
    },
  };
};

/** The domain's own validation, per field, for the form (the server runs the same rules). */
export const problemsOf = (policy: CreditPolicyValues): ReadonlyMap<string, PolicyProblem> =>
  new Map(validateCreditPolicy({ ...policy, version: 1 }).map((p) => [p.field, p]));

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;

/**
 * Plain-language consequences of the values that are below the working
 * defaults (or otherwise surprising), stated before a save is confirmed.
 */
export const consequences = (
  p: CreditPolicyValues,
  d: CreditPolicyValues,
): ReadonlyArray<string> => {
  const out: Array<string> = [];
  if (p.minInteractions < d.minInteractions || p.minObservers < d.minObservers) {
    out.push(
      `A badge could then come from ${plural(p.minInteractions, 'piece of work', 'pieces of work')} and ${plural(p.minObservers, 'observer', 'observers')} (the working defaults are ${d.minInteractions} and ${d.minObservers}).`,
    );
  }
  if (p.minSpanDays < d.minSpanDays) {
    out.push(
      p.minSpanDays === 0
        ? `All of that work could happen on a single day (the working default is ${d.minSpanDays} days apart).`
        : `All of that work could happen within ${plural(p.minSpanDays, 'day', 'days')} (the working default is ${d.minSpanDays}).`,
    );
  }
  if (p.minFirstHandShare < d.minFirstHandShare) {
    out.push(
      p.minFirstHandShare === 0
        ? 'None of the work would need to be seen first-hand: the observer’s account of a conversation would be enough.'
        : `Only ${pct(p.minFirstHandShare)} of the work would need to be seen first-hand (the working default is ${pct(d.minFirstHandShare)}).`,
    );
  }
  if (p.badgePoints < d.badgePoints) {
    out.push(`A badge would need ${p.badgePoints} points instead of ${d.badgePoints}.`);
  }
  if (p.primaryPoints < d.primaryPoints) {
    out.push(
      `Primary work would earn ${p.primaryPoints} points instead of ${d.primaryPoints}, so badges take more observed work.`,
    );
  }
  if (p.secondaryPoints < d.secondaryPoints) {
    out.push(
      `Secondary work would earn ${p.secondaryPoints} points instead of ${d.secondaryPoints}.`,
    );
  }
  if (p.secondaryPoints > p.primaryPoints) {
    out.push('Secondary work would be worth more than the work’s main skill.');
  }
  if (p.maxSkillsPerObservation < d.maxSkillsPerObservation) {
    out.push(
      `Observers could rate at most ${plural(p.maxSkillsPerObservation, 'skill', 'skills')} on one observation.`,
    );
  }
  if (!p.activityOverrides.enabled && d.activityOverrides.enabled) {
    out.push(
      'Values already given to activities stop applying: work signed from now on uses the template, skill or tenant value instead.',
    );
  } else if (
    p.activityOverrides.enabled &&
    (p.activityOverrides.minPoints > d.activityOverrides.minPoints ||
      p.activityOverrides.maxPoints < d.activityOverrides.maxPoints)
  ) {
    out.push(
      `An activity value outside ${p.activityOverrides.minPoints} to ${p.activityOverrides.maxPoints} points is ignored when its work is signed.`,
    );
  }
  return out;
};

/**
 * A worked example from the entered values: how much observed work reaches a
 * badge when the skill is primary, and when it is only secondary. Each piece
 * of work counts once, so the count is the larger of the points needed and
 * the minimum number of pieces of work.
 */
export const workedExample = (p: CreditPolicyValues): ReadonlyArray<string> => {
  const needed = (points: number) => Math.max(p.minInteractions, Math.ceil(p.badgePoints / points));
  const primary = needed(p.primaryPoints);
  const secondary = needed(p.secondaryPoints);
  const firstHand = (n: number) =>
    Math.max(1, Math.ceil(p.minFirstHandShare * Math.max(n, p.minInteractions)));
  const lines = [
    `A badge needs ${p.badgePoints} points from at least ${plural(p.minInteractions, 'piece of work', 'pieces of work')}, signed by at least ${plural(p.minObservers, 'person', 'different people')}${p.minSpanDays > 0 ? `, spread over at least ${plural(p.minSpanDays, 'day', 'days')}` : ''}.`,
    `Where the skill is primary (${p.primaryPoints} points each): ${plural(primary, 'piece of work', 'pieces of work')}, at least ${firstHand(primary)} of them seen first-hand.`,
  ];
  if (p.minPrimaryPoints > 0) {
    lines.push(
      `Where it is only secondary, work alone never reaches a badge: at least ${p.minPrimaryPoints} of the points must come from work where the skill was primary.`,
    );
  } else {
    lines.push(
      `Where it is only secondary (${p.secondaryPoints} points each): ${plural(secondary, 'piece of work', 'pieces of work')}, at least ${firstHand(secondary)} of them seen first-hand.`,
    );
  }
  return lines;
};

/** Field-by-field differences between two complete policies, for the confirmation. */
export const differences = (
  before: CreditPolicyValues | StoredCreditPolicy,
  after: CreditPolicyValues,
): ReadonlyArray<{ readonly label: string; readonly before: string; readonly after: string }> => {
  const rows = ALL_FIELDS.flatMap((f) => {
    const was = valueOf(before, f.field);
    const now = valueOf(after, f.field);
    return was === now
      ? []
      : [
          {
            label: f.label,
            before: was === null ? 'not set' : display(f.field, was),
            after: display(f.field, now),
          },
        ];
  });
  const [was, now] = [before.activityOverrides.enabled, after.activityOverrides.enabled];
  return was === now
    ? rows
    : [
        ...rows,
        {
          label: 'Activities may have their own value',
          before: yesNo(was),
          after: yesNo(now),
        },
      ];
};

/** The label of a stored field name (`activityOverrides.minPoints`, …) for the change history. */
export const fieldLabel = (field: string) =>
  field === 'activityOverrides.enabled'
    ? 'Activities may have their own value'
    : (spec(field as PolicyField)?.label ?? field);

/** A stored value in the change history, in the form's words (a share as a percentage). */
export const historyValue = (field: string, value: string | number | boolean | null) => {
  if (typeof value === 'number') return display(field as PolicyField, value);
  if (typeof value === 'boolean') return yesNo(value);
  return String(value);
};
