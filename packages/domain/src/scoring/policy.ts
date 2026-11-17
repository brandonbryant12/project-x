import type { SkillRole } from '../vocabulary.ts';

/**
 * Scoring policy. A credit is one *demonstration*: a skill shown at a level, in
 * a mode, seen by one observer, in one interaction. Each credit carries
 * *points*, resolved and frozen when it is signed, so a later change to any
 * setting never rewrites history. Badges count points per piece of work,
 * observers, first-hand share and time.
 *
 * This version is recorded on every credit, reversal and award together with
 * the tenant's credit-policy version (`creditPolicyVersion`).
 */
export const SCORING_POLICY_VERSION = 'scoring/2026-11-17.1';

/** No tenant may let an observation rate more skills than this (`observation_rating` positions 0..5). */
export const MAX_SKILLS_CEILING = 6;

/** Where a credit's points came from, most specific first; `legacy` marks credits signed before points. */
export const POINTS_SOURCES = ['activity', 'template', 'skill', 'tenant', 'legacy'] as const;
export type PointsSource = (typeof POINTS_SOURCES)[number];

/** Allowed range of one credit's points (also a database check). */
export const POINTS_RANGE = { min: 1, max: 1000 } as const;
/** Allowed range of a badge's points total. */
export const BADGE_POINTS_RANGE = { min: 1, max: 100_000 } as const;

/** What one credit was worth before points existed; legacy credits and thresholds convert with it. */
export const LEGACY_CREDIT_POINTS = 10;

/** The tenant's run-time settings for points and badge rules (`tenant.settings.creditPolicy`). */
export interface CreditPolicy {
  /** Starts at 1; every saved change adds one. */
  readonly version: number;
  readonly primaryPoints: number;
  readonly secondaryPoints: number;
  /** The points a badge needs. */
  readonly badgePoints: number;
  /** Distinct pieces of work a badge needs; never fewer than two. */
  readonly minInteractions: number;
  /** Distinct observers a badge needs; never fewer than two. */
  readonly minObservers: number;
  /** Share of the pieces of work that must have been seen first-hand. */
  readonly minFirstHandShare: number;
  /** Days between the first and last piece of work; never fewer than one. */
  readonly minSpanDays: number;
  /** 0 is off; above 0, that many of a badge's points must come from work where the skill was primary. */
  readonly minPrimaryPoints: number;
  readonly maxSkillsPerObservation: number;
  readonly activityOverrides: {
    readonly enabled: boolean;
    readonly minPoints: number;
    readonly maxPoints: number;
  };
}

/**
 * What `tenant.settings.creditPolicy` holds. Stored policies are complete (the
 * migration and every save write all fields); the type stays partial so that
 * reading is defensive.
 */
export type StoredCreditPolicy = Partial<Omit<CreditPolicy, 'activityOverrides'>> & {
  readonly activityOverrides?: Partial<CreditPolicy['activityOverrides']>;
};

/**
 * WORKING DEFAULTS, not decided rules (docs/engineering/decision-making.md):
 * every number here is configurable per tenant at run time, and the values used
 * are frozen on each credit and award.
 */
export const DEFAULT_CREDIT_POLICY: CreditPolicy = {
  version: 1,
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

/**
 * The screens' fallback for how many skills one observation rates, until they
 * read the tenant's policy. The server always uses `maxSkillsPerObservation`.
 */
export const MAX_SKILLS_PER_OBSERVATION = DEFAULT_CREDIT_POLICY.maxSkillsPerObservation;

type TopField = Exclude<keyof CreditPolicy, 'activityOverrides'>;
export type CreditPolicyField =
  | TopField
  | 'activityOverrides.minPoints'
  | 'activityOverrides.maxPoints';

export interface PolicyProblem {
  readonly field: CreditPolicyField;
  readonly message: string;
}

const isIntIn = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;
const wholeFrom = (min: number, max: number) => `Use a whole number from ${min} to ${max}.`;

/** Every rule a saved policy must satisfy. Empty when valid. */
export const validateCreditPolicy = (policy: CreditPolicy): ReadonlyArray<PolicyProblem> => {
  const problems: Array<PolicyProblem> = [];
  const need = (ok: boolean, field: CreditPolicyField, message: string) => {
    if (!ok) problems.push({ field, message });
  };
  const points = wholeFrom(POINTS_RANGE.min, POINTS_RANGE.max);
  const inPoints = (n: number) => isIntIn(n, POINTS_RANGE.min, POINTS_RANGE.max);
  need(isIntIn(policy.version, 1, Number.MAX_SAFE_INTEGER), 'version', 'Use 1 or more.');
  need(inPoints(policy.primaryPoints), 'primaryPoints', points);
  need(inPoints(policy.secondaryPoints), 'secondaryPoints', points);
  need(
    isIntIn(policy.badgePoints, BADGE_POINTS_RANGE.min, BADGE_POINTS_RANGE.max),
    'badgePoints',
    wholeFrom(BADGE_POINTS_RANGE.min, BADGE_POINTS_RANGE.max),
  );
  // Structural floors (ADR 0007): never one piece of work, one observer or one day.
  need(isIntIn(policy.minInteractions, 2, 50), 'minInteractions', wholeFrom(2, 50));
  need(isIntIn(policy.minObservers, 2, 10), 'minObservers', wholeFrom(2, 10));
  need(
    Number.isFinite(policy.minFirstHandShare) &&
      policy.minFirstHandShare >= 0 &&
      policy.minFirstHandShare <= 1,
    'minFirstHandShare',
    'Use a share from 0 to 1.',
  );
  need(isIntIn(policy.minSpanDays, 1, 3650), 'minSpanDays', wholeFrom(1, 3650));
  need(
    isIntIn(policy.minPrimaryPoints, 0, Math.max(0, policy.badgePoints)),
    'minPrimaryPoints',
    `Use a whole number from 0 to the badge's ${policy.badgePoints} points.`,
  );
  need(
    isIntIn(policy.maxSkillsPerObservation, 1, MAX_SKILLS_CEILING),
    'maxSkillsPerObservation',
    wholeFrom(1, MAX_SKILLS_CEILING),
  );
  const { enabled, minPoints, maxPoints } = policy.activityOverrides;
  need(typeof enabled === 'boolean' && inPoints(minPoints), 'activityOverrides.minPoints', points);
  need(
    inPoints(maxPoints) && maxPoints >= minPoints,
    'activityOverrides.maxPoints',
    `Use a whole number from ${POINTS_RANGE.min} to ${POINTS_RANGE.max}, no lower than the lowest value.`,
  );
  return problems;
};

/**
 * Merges a stored policy over the defaults, defensively: stored policies are
 * complete, but a tenant created with empty settings has none. A stored value
 * that breaks a rule falls back to its default, so a bad setting can never stop
 * signing; saving validates first and refuses such values.
 */
export const resolveCreditPolicy = (stored?: StoredCreditPolicy | null): CreditPolicy => {
  const merged: CreditPolicy = {
    ...DEFAULT_CREDIT_POLICY,
    ...stored,
    activityOverrides: { ...DEFAULT_CREDIT_POLICY.activityOverrides, ...stored?.activityOverrides },
  };
  const problems = validateCreditPolicy(merged);
  if (problems.length === 0) return merged;
  const top: Record<string, unknown> = { ...merged };
  let overrides = merged.activityOverrides;
  for (const { field } of problems) {
    if (field.startsWith('activityOverrides.')) overrides = DEFAULT_CREDIT_POLICY.activityOverrides;
    else top[field] = DEFAULT_CREDIT_POLICY[field as TopField];
  }
  const repaired = { ...top, activityOverrides: overrides } as unknown as CreditPolicy;
  return validateCreditPolicy(repaired).length === 0
    ? repaired
    : { ...DEFAULT_CREDIT_POLICY, version: repaired.version };
};

/** The version string recorded on credits, reversals and awards. */
export const creditPolicyVersion = (policy: Pick<CreditPolicy, 'version'>): string =>
  `${SCORING_POLICY_VERSION}#${policy.version}`;

/** The default role of a skill listed at `position` in a piece of work: the first is primary. */
export const defaultSkillRole = (position: number): SkillRole =>
  position === 0 ? 'primary' : 'secondary';

export type CreditPolicyChange =
  | { readonly ok: true; readonly policy: CreditPolicy }
  | { readonly ok: false; readonly reason: 'stale' }
  | {
      readonly ok: false;
      readonly reason: 'invalid';
      readonly problems: ReadonlyArray<PolicyProblem>;
    };

/**
 * A replacement of the tenant's policy, compared and set on its version: it
 * applies only to the version the editor saw, stores every field, and bumps the
 * version. The caller writes it with the same version condition in SQL.
 */
export const replaceCreditPolicy = (
  current: CreditPolicy,
  expectedVersion: number,
  proposed: Omit<CreditPolicy, 'version'>,
): CreditPolicyChange => {
  if (current.version !== expectedVersion) return { ok: false, reason: 'stale' };
  const policy: CreditPolicy = { ...proposed, version: current.version + 1 };
  const problems = validateCreditPolicy(policy);
  return problems.length > 0 ? { ok: false, reason: 'invalid', problems } : { ok: true, policy };
};
