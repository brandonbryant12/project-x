import type { TemplateSkillView } from '@repo/api';
import {
  SkillIndicatorId,
  SkillVersionId,
  type ActivityTemplateId,
  type PersonId,
  type PreparedLevel,
  type SkillId,
  type SkillRole,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { loadSkills, toSkillRef } from './skills.ts';

/**
 * Writes one immutable skill version: its row, its four levels and their
 * indicators, each with a fresh id and the lineage key it carries over. The
 * only way a version is written, by the seed and by program owners publishing
 * (skill_version, skill_level and skill_indicator are append-only by trigger).
 * The caller points the skill at it.
 */
export const insertSkillVersion = Effect.fn('catalog.insertSkillVersion')(function* (input: {
  readonly tenantId: TenantId;
  readonly skillId: SkillId;
  readonly number: number;
  readonly levels: ReadonlyArray<PreparedLevel>;
  readonly publishedById: PersonId | null;
  readonly publishedAt: Date;
  readonly changeNote: string | null;
}) {
  const db = yield* Db;
  const id = SkillVersionId.generate();
  yield* db.insert(schema.skillVersion).values({
    id,
    tenantId: input.tenantId,
    skillId: input.skillId,
    number: input.number,
    publishedById: input.publishedById,
    publishedAt: input.publishedAt,
    changeNote: input.changeNote,
  });
  yield* db.insert(schema.skillLevel).values(
    input.levels.map((l) => ({
      tenantId: input.tenantId,
      skillVersionId: id,
      level: l.level,
      summary: l.summary,
    })),
  );
  const indicators = input.levels.flatMap((l) =>
    l.indicators.map((i, position) => ({
      id: SkillIndicatorId.generate(),
      tenantId: input.tenantId,
      skillVersionId: id,
      level: l.level,
      lineageKey: i.lineageKey,
      text: i.text,
      position,
    })),
  );
  if (indicators.length > 0) yield* db.insert(schema.skillIndicator).values(indicators);
  return id;
});

export interface TemplateSkillEntry {
  readonly skillId: SkillId;
  readonly role: SkillRole;
  readonly points: number | null;
}

/** Each template's skills in order, with the role and the template's value for each. */
export const loadTemplateSkillEntries = Effect.fn('catalog.templateSkillEntries')(function* (
  tenantId: TenantId,
  templateIds: ReadonlyArray<ActivityTemplateId>,
) {
  const result = new Map<ActivityTemplateId, Array<TemplateSkillEntry>>();
  if (templateIds.length === 0) return result;
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.activityTemplateSkill)
    .where(
      and(
        eq(schema.activityTemplateSkill.tenantId, tenantId),
        inArray(schema.activityTemplateSkill.templateId, [...templateIds]),
      ),
    )
    .orderBy(asc(schema.activityTemplateSkill.position));
  for (const row of rows) {
    const list = result.get(row.templateId) ?? [];
    list.push({ skillId: row.skillId, role: row.role as SkillRole, points: row.points });
    result.set(row.templateId, list);
  }
  return result;
});

/** The same entries as views, with the skill rows they refer to (for status checks). */
export const templateSkillViews = Effect.fn('catalog.templateSkillViews')(function* (
  tenantId: TenantId,
  templateIds: ReadonlyArray<ActivityTemplateId>,
) {
  const entries = yield* loadTemplateSkillEntries(tenantId, templateIds);
  const skills = yield* loadSkills(
    tenantId,
    [...entries.values()].flat().map((e) => e.skillId),
  );
  const views = new Map<
    ActivityTemplateId,
    Array<TemplateSkillView & { readonly skillStatus: string }>
  >();
  for (const [templateId, list] of entries) {
    views.set(
      templateId,
      list.flatMap((e) => {
        const row = skills.get(e.skillId);
        return row
          ? [{ skill: toSkillRef(row), role: e.role, points: e.points, skillStatus: row.status }]
          : [];
      }),
    );
  }
  return views;
});
