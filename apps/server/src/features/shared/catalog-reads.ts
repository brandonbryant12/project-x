import type {
  ActivitySkillValue,
  Level,
  PlanId,
  SkillDefinition,
  SkillId,
  SkillIndicatorId,
  SkillVersionId,
  SkillRole,
  TenantId,
  ActivityId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { businessDateIn } from '../../platform/time.ts';

/** Rebuilds published definitions from relational rows (docs/architecture/data-model.md). */
export const loadDefinitions = Effect.fn('catalog.definitions')(function* (
  tenantId: TenantId,
  versionIds: ReadonlyArray<SkillVersionId>,
) {
  const unique = [...new Set(versionIds)];
  const result = new Map<SkillVersionId, SkillDefinition>();
  if (unique.length === 0) return result;
  const db = yield* Db;
  const [levels, indicators] = yield* Effect.all([
    db
      .select()
      .from(schema.skillLevel)
      .where(
        and(
          eq(schema.skillLevel.tenantId, tenantId),
          inArray(schema.skillLevel.skillVersionId, unique),
        ),
      )
      .orderBy(asc(schema.skillLevel.level)),
    db
      .select()
      .from(schema.skillIndicator)
      .where(
        and(
          eq(schema.skillIndicator.tenantId, tenantId),
          inArray(schema.skillIndicator.skillVersionId, unique),
        ),
      )
      .orderBy(asc(schema.skillIndicator.position)),
  ]);
  for (const versionId of unique) {
    result.set(versionId, {
      levels: levels
        .filter((l) => l.skillVersionId === versionId)
        .map((l) => ({
          level: l.level as Level,
          summary: l.summary,
          indicators: indicators
            .filter((i) => i.skillVersionId === versionId && i.level === l.level)
            .map((i) => ({ id: i.id as SkillIndicatorId, lineageKey: i.lineageKey, text: i.text })),
        })),
    });
  }
  return result;
});

export interface PlanSkillRow {
  readonly skillId: SkillId;
  readonly targetLevel: Level;
  readonly outcome: string | null;
}

export const loadPlanSkills = Effect.fn('plan.skills')(function* (
  tenantId: TenantId,
  planIds: ReadonlyArray<PlanId>,
) {
  const result = new Map<PlanId, Array<PlanSkillRow>>();
  if (planIds.length === 0) return result;
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.planSkill)
    .where(
      and(eq(schema.planSkill.tenantId, tenantId), inArray(schema.planSkill.planId, [...planIds])),
    )
    .orderBy(asc(schema.planSkill.position));
  for (const row of rows) {
    const list = result.get(row.planId) ?? [];
    list.push({
      skillId: row.skillId,
      targetLevel: row.targetLevel as Level,
      outcome: row.outcome,
    });
    result.set(row.planId, list);
  }
  return result;
});

export type ActivitySkillRow = typeof schema.activitySkill.$inferSelect;

/**
 * A skill row as value resolution reads it. An individual value reaches work
 * done on or after the business date it was set (in the tenant's time zone)
 * and logged at or after the moment it was set (I38).
 */
export const activitySkillValue = (
  row: Pick<ActivitySkillRow, 'role' | 'pointsOverride' | 'pointsOverrideAt' | 'templatePoints'>,
  timeZone: string,
): ActivitySkillValue => ({
  role: row.role as SkillRole,
  pointsOverride: row.pointsOverride,
  pointsOverrideAt: row.pointsOverrideAt,
  pointsOverrideFrom: row.pointsOverrideAt ? businessDateIn(row.pointsOverrideAt, timeZone) : null,
  templatePoints: row.templatePoints,
});

/** Each activity's skill rows (role and values included), in position order. */
export const loadActivitySkillRows = Effect.fn('activity.skillRows')(function* (
  tenantId: TenantId,
  activityIds: ReadonlyArray<ActivityId>,
) {
  const result = new Map<ActivityId, Array<ActivitySkillRow>>();
  if (activityIds.length === 0) return result;
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.activitySkill)
    .where(
      and(
        eq(schema.activitySkill.tenantId, tenantId),
        inArray(schema.activitySkill.activityId, [...activityIds]),
      ),
    )
    .orderBy(asc(schema.activitySkill.position), asc(schema.activitySkill.skillId));
  for (const row of rows) result.set(row.activityId, [...(result.get(row.activityId) ?? []), row]);
  return result;
});
