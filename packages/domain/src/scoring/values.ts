import type { IsoDate, SkillId } from '../ids.ts';
import type { SkillRole } from '../vocabulary.ts';
import type { CreditPolicy, PointsSource } from './policy.ts';

/** This skill on the activity the work belongs to (`activity_skill`). */
export interface ActivitySkillValue {
  readonly role: SkillRole;
  /** The activity's own value, set by a plan agreer or program owner. */
  readonly pointsOverride: number | null;
  /** The moment the activity's own value was set (server time). */
  readonly pointsOverrideAt: Date | null;
  /** The business date of `pointsOverrideAt` in the tenant's zone. */
  readonly pointsOverrideFrom: IsoDate | null;
  /** The template's value, copied when the work was added; never read live from the template. */
  readonly templatePoints: number | null;
}

/**
 * What one credit is worth, resolved once inside the signing transaction and
 * frozen on the credit row. Most specific wins:
 *
 * 1. the activity's own value for this skill (`activity`), only for work done
 *    on or after the business date the value was set AND logged at or after
 *    the moment it was set (server time, which nobody can backdate), so a value
 *    never reaches work that was already logged, even earlier the same day;
 *    only while the tenant allows individual values AND the value lies inside
 *    the range in force at signing; otherwise it is not applied (never clamped:
 *    a value nobody chose is never written to the ledger) and resolution falls
 *    through;
 * 2. the template's value copied onto the activity, when the credit's role
 *    equals the skill's role on the activity (`template`);
 * 3. the skill's value for the role (`skill`);
 * 4. the tenant's value for the role (`tenant`).
 */
export interface WorkTiming {
  readonly on: IsoDate;
  readonly loggedAt: Date;
}

/** Whether the activity's own value was set early enough to reach this work. */
const valueReaches = (activity: ActivitySkillValue, work: WorkTiming | null): boolean =>
  work !== null &&
  activity.pointsOverrideFrom !== null &&
  activity.pointsOverrideAt !== null &&
  work.on >= activity.pointsOverrideFrom &&
  work.loggedAt.getTime() >= activity.pointsOverrideAt.getTime();

export interface CreditValueInput {
  readonly role: SkillRole;
  readonly policy: CreditPolicy;
  /**
   * The work being valued: the date it was done (chosen by the person) and
   * when it was logged (`interaction.created_at`, server time). Null when there
   * is no work (a value in general).
   */
  readonly work: WorkTiming | null;
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

export const resolveCreditValue = ({
  role,
  policy,
  work,
  activity,
  skill,
}: CreditValueInput): CreditValue => {
  const overrides = policy.activityOverrides;
  const override = activity?.pointsOverride;
  if (
    overrides.enabled &&
    activity != null &&
    override != null &&
    valueReaches(activity, work) &&
    override >= overrides.minPoints &&
    override <= overrides.maxPoints
  ) {
    return { points: override, source: 'activity' };
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
  primary: resolveCreditValue({ role: 'primary', policy, work: null, skill }).points,
  secondary: resolveCreditValue({ role: 'secondary', policy, work: null, skill }).points,
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
