import type { SkillId } from '../ids.ts';
import type { SkillRole } from '../vocabulary.ts';
import type { CreditPolicy, PointsSource } from './policy.ts';

/** This skill on the activity the work belongs to (`activity_skill`). */
export interface ActivitySkillValue {
  readonly role: SkillRole;
  /** The activity's own value, set by a plan agreer or program owner. */
  readonly pointsOverride: number | null;
  /** The template's value, copied when the work was added; never read live from the template. */
  readonly templatePoints: number | null;
}

/**
 * What one credit is worth, resolved once inside the signing transaction and
 * frozen on the credit row. Most specific wins:
 *
 * 1. the activity's own value for this skill (`activity`), while the tenant
 *    allows individual values, kept inside the tenant's current range;
 * 2. the template's value copied onto the activity, when the credit's role
 *    equals the skill's role on the activity (`template`);
 * 3. the skill's value for the role (`skill`);
 * 4. the tenant's value for the role (`tenant`).
 */
export interface CreditValueInput {
  readonly role: SkillRole;
  readonly policy: CreditPolicy;
  readonly activity?: ActivitySkillValue | null | undefined;
  readonly skill?:
    | { readonly primaryPoints: number | null; readonly secondaryPoints: number | null }
    | null
    | undefined;
}

export interface CreditValue {
  readonly points: number;
  readonly source: Exclude<PointsSource, 'legacy'>;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const resolveCreditValue = ({
  role,
  policy,
  activity,
  skill,
}: CreditValueInput): CreditValue => {
  const overrides = policy.activityOverrides;
  if (overrides.enabled && activity?.pointsOverride != null) {
    return {
      points: clamp(activity.pointsOverride, overrides.minPoints, overrides.maxPoints),
      source: 'activity',
    };
  }
  if (activity?.templatePoints != null && activity.role === role) {
    return { points: activity.templatePoints, source: 'template' };
  }
  const skillPoints = role === 'primary' ? skill?.primaryPoints : skill?.secondaryPoints;
  if (skillPoints != null) return { points: skillPoints, source: 'skill' };
  return {
    points: role === 'primary' ? policy.primaryPoints : policy.secondaryPoints,
    source: 'tenant',
  };
};

/** What one observation in a skill is worth by role, before any activity value. */
export const roleValues = (
  policy: CreditPolicy,
  skill?: { readonly primaryPoints: number | null; readonly secondaryPoints: number | null } | null,
): Readonly<Record<SkillRole, number>> => ({
  primary: resolveCreditValue({ role: 'primary', policy, skill }).points,
  secondary: resolveCreditValue({ role: 'secondary', policy, skill }).points,
});

export interface RatedSkill {
  readonly skillId: SkillId;
  /** The observer's choice in this draft or signature. */
  readonly chosen?: SkillRole | null | undefined;
  /** The role already stored on the observation's rating, if any. */
  readonly stored?: SkillRole | null | undefined;
}

export type RoleResolution =
  | { readonly ok: true; readonly roles: ReadonlyArray<SkillRole> }
  | { readonly ok: false; readonly reason: 'two_primaries' };

/**
 * The role of each rated skill, in rating order. The observer owns the roles
 * on an observation (as they own the mode); the activity only gives defaults.
 *
 * - Each rating takes the observer's choice, else the role already stored on
 *   the observation, else its role on the activity, else `secondary`.
 * - A primary from a stronger source (choice > stored > activity default)
 *   demotes primaries from weaker ones, so a later edit to the activity never
 *   changes an observation that already exists.
 * - A new observation (nothing chosen or stored) whose rated skills include no
 *   primary on the activity makes the first rated skill primary.
 * - Two primaries from the same source are refused.
 */
export const resolveRatingRoles = (
  activitySkills: ReadonlyArray<{ readonly skillId: SkillId; readonly role: SkillRole }>,
  ratings: ReadonlyArray<RatedSkill>,
): RoleResolution => {
  const candidates = ratings.map((rating) => {
    if (rating.chosen != null) return { role: rating.chosen, rank: 2 };
    if (rating.stored != null) return { role: rating.stored, rank: 1 };
    const listed = activitySkills.find((s) => s.skillId === rating.skillId)?.role;
    return { role: listed ?? ('secondary' as SkillRole), rank: 0 };
  });
  const strongest = Math.max(
    -1,
    ...candidates.filter((c) => c.role === 'primary').map((c) => c.rank),
  );
  const roles = candidates.map((c): SkillRole =>
    c.role === 'primary' && c.rank === strongest ? 'primary' : 'secondary',
  );
  if (roles.filter((r) => r === 'primary').length > 1)
    return { ok: false, reason: 'two_primaries' };
  const fresh = candidates.every((c) => c.rank === 0);
  if (fresh && strongest < 0 && roles.length > 0) roles[0] = 'primary';
  return { ok: true, roles };
};
