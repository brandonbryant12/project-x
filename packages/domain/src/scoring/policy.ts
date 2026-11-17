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

/**
 * The tenant's run-time settings for points and badge rules
 * (`tenant.settings.creditPolicy`). Always stored complete and read exactly as
 * stored (`readStoredCreditPolicy`): there is no merging over defaults, so the
 * same version always means the same values.
 */
export interface CreditPolicy {
  /** Starts at 1; every saved change adds one. */
  readonly version: number;
  readonly primaryPoints: number;
  readonly secondaryPoints: number;
  /** The points a badge needs. */
  readonly badgePoints: number;
  /** Distinct pieces of work a badge needs. */
  readonly minInteractions: number;
  /** Distinct observers a badge needs. */
  readonly minObservers: number;
  /** Share of the pieces of work that must have been seen first-hand. */
  readonly minFirstHandShare: number;
  /** Days between the first and last piece of work. */
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

/** What `tenant.settings.creditPolicy` may hold when it is broken: any field may be missing. */
export type StoredCreditPolicy = Partial<Omit<CreditPolicy, 'activityOverrides'>> & {
  readonly activityOverrides?: Partial<CreditPolicy['activityOverrides']>;
};

/**
 * WORKING DEFAULTS, not decided rules (docs/engineering/decision-making.md).
 * They are written once, as version 1, when a tenant is created
 * (`initialCreditPolicy`); a tenant's stored policy never falls back to them.
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

/** The complete policy every new tenant is created with (seed, tests, import): the working defaults as version 1. */
export const initialCreditPolicy = (): CreditPolicy => ({
  ...DEFAULT_CREDIT_POLICY,
  activityOverrides: { ...DEFAULT_CREDIT_POLICY.activityOverrides },
  version: 1,
});

export type CreditPolicyField =
  | 'creditPolicy'
  | Exclude<keyof CreditPolicy, 'activityOverrides'>
  | 'activityOverrides.enabled'
  | 'activityOverrides.minPoints'
  | 'activityOverrides.maxPoints';

export interface PolicyProblem {
  readonly field: CreditPolicyField;
  readonly message: string;
}

const isIntIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const wholeFrom = (min: number, max: number) => `Use a whole number from ${min} to ${max}.`;

/**
 * Every rule a policy must satisfy; empty when valid. Works on a stored policy
 * of unknown shape, so a missing or mistyped field is reported, never filled.
 *
 * Only the minimums are rules: each criterion must be able to mean something
 * (at least one piece of work, one observer, a span of zero days or more). The
 * upper bounds are INPUT SANITY LIMITS, not business rules: points 1..1000, a
 * badge up to 100000 points, 50 pieces of work, 10 observers, 3650 days and the
 * database's ceiling of six skills on one observation.
 */
export const validateCreditPolicy = (
  policy: StoredCreditPolicy | null | undefined,
): ReadonlyArray<PolicyProblem> => {
  if (policy === null || typeof policy !== 'object') {
    return [{ field: 'creditPolicy', message: 'No credit policy is stored.' }];
  }
  const problems: Array<PolicyProblem> = [];
  const need = (ok: boolean, field: CreditPolicyField, message: string) => {
    if (!ok) problems.push({ field, message });
  };
  const points = wholeFrom(POINTS_RANGE.min, POINTS_RANGE.max);
  const inPoints = (n: unknown) => isIntIn(n, POINTS_RANGE.min, POINTS_RANGE.max);
  need(isIntIn(policy.version, 1, Number.MAX_SAFE_INTEGER), 'version', 'Use 1 or more.');
  need(inPoints(policy.primaryPoints), 'primaryPoints', points);
  need(inPoints(policy.secondaryPoints), 'secondaryPoints', points);
  need(
    isIntIn(policy.badgePoints, BADGE_POINTS_RANGE.min, BADGE_POINTS_RANGE.max),
    'badgePoints',
    wholeFrom(BADGE_POINTS_RANGE.min, BADGE_POINTS_RANGE.max),
  );
  need(isIntIn(policy.minInteractions, 1, 50), 'minInteractions', wholeFrom(1, 50));
  need(isIntIn(policy.minObservers, 1, 10), 'minObservers', wholeFrom(1, 10));
  const share = policy.minFirstHandShare;
  need(
    typeof share === 'number' && Number.isFinite(share) && share >= 0 && share <= 1,
    'minFirstHandShare',
    'Use a share from 0 to 1.',
  );
  need(isIntIn(policy.minSpanDays, 0, 3650), 'minSpanDays', wholeFrom(0, 3650));
  // Bounded by the badge's points when those are valid (else reported there).
  const badge = isIntIn(policy.badgePoints, 1, BADGE_POINTS_RANGE.max)
    ? policy.badgePoints
    : BADGE_POINTS_RANGE.max;
  need(
    isIntIn(policy.minPrimaryPoints, 0, badge),
    'minPrimaryPoints',
    `Use a whole number from 0 to the badge's ${badge} points.`,
  );
  need(
    isIntIn(policy.maxSkillsPerObservation, 1, MAX_SKILLS_CEILING),
    'maxSkillsPerObservation',
    wholeFrom(1, MAX_SKILLS_CEILING),
  );
  const overrides = policy.activityOverrides;
  need(
    typeof overrides?.enabled === 'boolean',
    'activityOverrides.enabled',
    'Say whether an activity may have its own value.',
  );
  need(inPoints(overrides?.minPoints), 'activityOverrides.minPoints', points);
  need(
    inPoints(overrides?.maxPoints) && (overrides?.maxPoints ?? 0) >= (overrides?.minPoints ?? 0),
    'activityOverrides.maxPoints',
    `Use a whole number from ${POINTS_RANGE.min} to ${POINTS_RANGE.max}, no lower than the lowest value.`,
  );
  return problems;
};

export type StoredPolicyReading =
  | { readonly ok: true; readonly policy: CreditPolicy }
  | {
      readonly ok: false;
      readonly stored: StoredCreditPolicy | null;
      readonly problems: ReadonlyArray<PolicyProblem>;
    };

/**
 * Reads a stored policy exactly as stored, or reports it as broken with its
 * problems. Nothing is merged in and no default is substituted: signing and
 * policy-dependent reads must fail loudly on a broken policy, and the
 * administration screen shows the problems so a program owner can repair it.
 */
export const readStoredCreditPolicy = (stored: unknown): StoredPolicyReading => {
  const candidate = (
    stored !== null && typeof stored === 'object' ? stored : null
  ) as StoredCreditPolicy | null;
  const problems = validateCreditPolicy(candidate);
  return problems.length === 0
    ? { ok: true, policy: candidate as CreditPolicy }
    : { ok: false, stored: candidate, problems };
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
 * version. `storedVersion` is 0 when the stored policy has no valid version, so
 * a broken policy can still be repaired. `highestRecorded` is the highest
 * version the tenant has ever used (its audit events and credits): the new
 * version is always above it, so a policy that lost its version never reuses
 * one already on the record. The caller writes it with the same version
 * condition in SQL and audits it.
 */
export const replaceCreditPolicy = (
  storedVersion: number,
  expectedVersion: number,
  proposed: Omit<CreditPolicy, 'version'>,
  highestRecorded = 0,
): CreditPolicyChange => {
  if (storedVersion !== expectedVersion) return { ok: false, reason: 'stale' };
  const policy: CreditPolicy = {
    ...proposed,
    version: Math.max(storedVersion, highestRecorded) + 1,
  };
  const problems = validateCreditPolicy(policy);
  return problems.length > 0 ? { ok: false, reason: 'invalid', problems } : { ok: true, policy };
};
