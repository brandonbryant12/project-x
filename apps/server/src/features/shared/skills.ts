import type { SkillRef } from '@repo/api';
import type { SkillDomain, SkillId, TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

type SkillRow = typeof schema.skill.$inferSelect;

export const toSkillRef = (row: SkillRow): SkillRef => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  domain: row.domain as SkillDomain,
});

export const loadSkills = Effect.fn('skills.load')(function* (
  tenantId: TenantId,
  ids: ReadonlyArray<SkillId>,
) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<SkillId, SkillRow>();
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.skill)
    .where(and(eq(schema.skill.tenantId, tenantId), inArray(schema.skill.id, unique)));
  return new Map(rows.map((row) => [row.id, row]));
});

/** Ordered refs for ids, skipping any that no longer exist. */
export const refsFor = (
  skills: ReadonlyMap<SkillId, SkillRow>,
  ids: ReadonlyArray<SkillId>,
): Array<SkillRef> =>
  ids.flatMap((id) => {
    const row = skills.get(id);
    return row ? [toSkillRef(row)] : [];
  });
