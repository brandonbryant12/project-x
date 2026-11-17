import { Unprocessable } from '@repo/api';
import {
  resolveCreditValue,
  resolveRatingRoles,
  type ActivityId,
  type ActivitySkillValue,
  type CreditPolicy,
  type CreditValue,
  type InteractionId,
  type IsoDate,
  type PersonId,
  type PositionId,
  type RatedSkill,
  type SkillId,
  type SkillRole,
  type TenantId,
  type WorkTiming,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, asc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { BusinessTimeZone } from '../../../platform/time.ts';
import { activitySkillValue } from '../../shared/catalog-reads.ts';
import { loadSkills } from '../../shared/skills.ts';

/**
 * Roles and values of rated skills (design 2026-11-17 rev. 2, §4). The observer
 * owns the roles on an observation; the activity's roles are only defaults.
 * What each credit is worth is resolved only inside the signing transaction,
 * from the activity's own value, the template value copied onto the activity,
 * the skill's value, then the tenant's. The live template is never read.
 */
export type ListedSkill = ActivitySkillValue & { readonly skillId: SkillId };

/** An activity's listed skills in order, with their roles and values. */
export const skillsOfActivity = Effect.fn('observations.activitySkills')(function* (
  tenantId: TenantId,
  activityId: ActivityId,
) {
  const db = yield* Db;
  const rows = yield* db
    .select({
      skillId: schema.activitySkill.skillId,
      role: schema.activitySkill.role,
      pointsOverride: schema.activitySkill.pointsOverride,
      pointsOverrideAt: schema.activitySkill.pointsOverrideAt,
      templatePoints: schema.activitySkill.templatePoints,
    })
    .from(schema.activitySkill)
    .where(
      and(
        eq(schema.activitySkill.tenantId, tenantId),
        eq(schema.activitySkill.activityId, activityId),
      ),
    )
    .orderBy(asc(schema.activitySkill.position), asc(schema.activitySkill.skillId));
  const timeZone = yield* BusinessTimeZone;
  return rows.map((s): ListedSkill => ({ skillId: s.skillId, ...activitySkillValue(s, timeZone) }));
});

/** The listed skills of the activity an interaction belongs to. */
export const skillsOfWork = Effect.fn('observations.workSkills')(function* (
  tenantId: TenantId,
  interactionId: InteractionId,
) {
  const db = yield* Db;
  const [work] = yield* db
    .select({ activityId: schema.interaction.activityId })
    .from(schema.interaction)
    .where(
      and(eq(schema.interaction.tenantId, tenantId), eq(schema.interaction.id, interactionId)),
    );
  if (!work) return yield* Effect.die('invariant: observation without interaction');
  return yield* skillsOfActivity(tenantId, work.activityId);
});

/** Roles for ratings in order, or `Unprocessable` when two would be primary. */
export const rolesFor = (
  listed: ReadonlyArray<ListedSkill>,
  ratings: ReadonlyArray<RatedSkill>,
) => {
  const resolved = resolveRatingRoles(listed, ratings);
  return resolved.ok
    ? Effect.succeed(resolved.roles)
    : Effect.fail(
        new Unprocessable({
          message: 'Only one skill can be the primary skill of this work.',
          field: 'ratings',
        }),
      );
};

/** Refuses more rated skills than the tenant's policy allows. */
export const requireSkillLimit = (policy: CreditPolicy, count: number) =>
  count <= policy.maxSkillsPerObservation
    ? Effect.void
    : Effect.fail(
        new Unprocessable({
          message: `Rate up to ${policy.maxSkillsPerObservation} different skills.`,
          field: 'ratings',
        }),
      );

/**
 * What each credit of this work (done on `work.on`, logged at `work.loggedAt`)
 * is worth, by skill and role. Call only inside the signing transaction.
 */
export const creditValues = Effect.fn('observations.creditValues')(function* (
  tenantId: TenantId,
  policy: CreditPolicy,
  listed: ReadonlyArray<ListedSkill>,
  skillIds: ReadonlyArray<SkillId>,
  work: WorkTiming,
) {
  const skills = yield* loadSkills(tenantId, skillIds);
  return (skillId: SkillId, role: SkillRole): CreditValue =>
    resolveCreditValue({
      role,
      policy,
      work,
      activity: listed.find((s) => s.skillId === skillId),
      skill: skills.get(skillId),
    });
});

/** The subject's position on the interaction date, when the directory knows it (ADR 0017). */
export const positionOn = Effect.fn('observations.positionOn')(function* (
  tenantId: TenantId,
  personId: PersonId,
  on: IsoDate,
) {
  const db = yield* Db;
  const [row] = yield* db
    .select({ id: schema.personPosition.id })
    .from(schema.personPosition)
    .where(
      and(
        eq(schema.personPosition.tenantId, tenantId),
        eq(schema.personPosition.personId, personId),
        lte(schema.personPosition.validFrom, on),
        or(isNull(schema.personPosition.validTo), gt(schema.personPosition.validTo, on)),
      ),
    )
    .limit(1);
  return (row?.id ?? null) as PositionId | null;
});
