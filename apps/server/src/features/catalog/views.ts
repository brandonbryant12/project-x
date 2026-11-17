import {
  CurrentActor,
  NotFound,
  type SkillCard,
  type SkillValueDifference,
  type TemplateCard,
} from '@repo/api';
import {
  LEVEL_NAMES,
  type InteractionKind,
  type Level,
  type PersonId,
  type SkillDomain,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { loadPeople, personFrom } from '../shared/people.ts';
import { progressFor, tenantCreditPolicy } from '../shared/recognition.ts';
import { templateSkillViews } from '../shared/catalog.ts';
import { loadDefinitions } from '../shared/catalog-reads.ts';
import { currentPlanSkillIds } from '../shared/plans.ts';
import { toSkillRef } from '../shared/skills.ts';

interface SkillsQuery {
  readonly q?: string | undefined;
  readonly domain?: SkillDomain | undefined;
}

const badgeStats = Effect.fn('catalog.badgeStats')(function* (tenantId: TenantId) {
  const db = yield* Db;
  const rows = yield* db
    .select({
      skillId: schema.badgeAward.skillId,
      personId: schema.badgeAward.personId,
      level: schema.badgeAward.level,
    })
    .from(schema.badgeAward)
    .where(and(eq(schema.badgeAward.tenantId, tenantId), eq(schema.badgeAward.status, 'awarded')));
  return rows;
});

const toTemplateCards = Effect.fn('catalog.templateCards')(function* (
  tenantId: TenantId,
  rows: ReadonlyArray<typeof schema.activityTemplate.$inferSelect>,
) {
  const views = yield* templateSkillViews(
    tenantId,
    rows.map((r) => r.id),
  );
  return rows.map((r): TemplateCard => {
    const skills = views.get(r.id) ?? [];
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      kind: r.kind as InteractionKind,
      suggestedSkills: skills.map((s) => s.skill),
      skills: skills.map(({ skill, role, points }) => ({ skill, role, points })),
      typicalMinutes: r.typicalMinutes,
      observationTip: r.observationTip,
    };
  });
});

/** `GET /catalog/skills`: published skills, with holder counts and the caller's own standing. */
export const searchSkills = Effect.fn('catalog.skills')(function* (query: SkillsQuery) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const conditions = [
    eq(schema.skill.tenantId, actor.tenantId),
    eq(schema.skill.status, 'published'),
  ];
  if (query.domain) conditions.push(eq(schema.skill.domain, query.domain));
  if (query.q) {
    const like = `%${query.q}%`;
    const match = or(ilike(schema.skill.name, like), ilike(schema.skill.summary, like));
    if (match) conditions.push(match);
  }
  const rows = yield* db
    .select()
    .from(schema.skill)
    .where(and(...conditions))
    .orderBy(asc(schema.skill.name));
  const [stats, inPlan] = yield* Effect.all([
    badgeStats(actor.tenantId),
    currentPlanSkillIds(actor.tenantId, actor.personId),
  ]);
  return rows.map((row): SkillCard => {
    const holders = new Set(stats.filter((s) => s.skillId === row.id).map((s) => s.personId));
    const mine = stats
      .filter((s) => s.skillId === row.id && s.personId === actor.personId)
      .map((s) => s.level);
    return {
      ...toSkillRef(row),
      summary: row.summary,
      outcome: row.outcome,
      tags: row.tags,
      holderCount: holders.size,
      inMyPlan: inPlan.has(row.id),
      myHighestLevel: mine.length > 0 ? Math.max(...mine) : null,
    };
  });
});

/** `GET /catalog/skills/:slug`: the current version's levels, holders and templates. */
export const buildSkillDetail = Effect.fn('catalog.skill')(function* (slug: string) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.skill)
    .where(and(eq(schema.skill.tenantId, actor.tenantId), eq(schema.skill.slug, slug)));
  if (!row || !row.currentVersionId || row.status === 'draft') {
    return yield* Effect.fail(new NotFound({ entity: 'skill', id: slug }));
  }
  const [version] = yield* db
    .select()
    .from(schema.skillVersion)
    .where(eq(schema.skillVersion.id, row.currentVersionId));
  if (!version) return yield* Effect.die('invariant: current skill version missing');
  const definitions = yield* loadDefinitions(actor.tenantId, [version.id]);
  const stats = (yield* badgeStats(actor.tenantId)).filter((s) => s.skillId === row.id);
  const highest = new Map<PersonId, number>();
  for (const s of stats) highest.set(s.personId, Math.max(highest.get(s.personId) ?? 0, s.level));
  const people = yield* loadPeople(actor.tenantId, [...highest.keys()]);
  const templates = yield* db
    .select({ template: schema.activityTemplate })
    .from(schema.activityTemplate)
    .innerJoin(
      schema.activityTemplateSkill,
      eq(schema.activityTemplateSkill.templateId, schema.activityTemplate.id),
    )
    .where(
      and(
        eq(schema.activityTemplate.tenantId, actor.tenantId),
        eq(schema.activityTemplate.status, 'published'),
        eq(schema.activityTemplateSkill.skillId, row.id),
      ),
    )
    .pipe(Effect.map((rows) => rows.map((r) => r.template)));
  const inPlan = yield* currentPlanSkillIds(actor.tenantId, actor.personId);
  const [progress] = yield* progressFor(actor.tenantId, actor.personId, [row.id]);
  const policy = yield* tenantCreditPolicy(actor.tenantId);
  const tenantValue = {
    primaryPoints: policy.primaryPoints,
    secondaryPoints: policy.secondaryPoints,
    badgePoints: policy.badgePoints,
    minPrimaryPoints: policy.minPrimaryPoints,
  };
  const mine = highest.get(actor.personId) ?? null;
  return {
    ...toSkillRef(row),
    summary: row.summary,
    outcome: row.outcome,
    tags: row.tags,
    holderCount: highest.size,
    inMyPlan: inPlan.has(row.id),
    myHighestLevel: mine,
    versionId: version.id,
    version: version.number,
    levels: definitions.get(version.id)?.levels ?? [],
    holders: [...highest.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .map(([personId, level]) => ({
        person: personFrom(people, personId),
        level,
        levelName: LEVEL_NAMES[level as Level],
      })),
    templates: yield* toTemplateCards(actor.tenantId, templates),
    myProgress: progress ?? null,
    valueDifferences: (Object.keys(tenantValue) as Array<keyof typeof tenantValue>).flatMap(
      (key): Array<SkillValueDifference> => {
        const value = row[key];
        return value !== null && value !== tenantValue[key]
          ? [{ key, value, tenantValue: tenantValue[key] }]
          : [];
      },
    ),
  };
});

/** `GET /catalog/templates`: published activity templates. */
export const searchTemplates = Effect.fn('catalog.templates')(function* (query: {
  readonly q?: string | undefined;
}) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const conditions = [
    eq(schema.activityTemplate.tenantId, actor.tenantId),
    eq(schema.activityTemplate.status, 'published'),
  ];
  if (query.q) conditions.push(ilike(schema.activityTemplate.name, `%${query.q}%`));
  const rows = yield* db
    .select()
    .from(schema.activityTemplate)
    .where(and(...conditions))
    .orderBy(asc(schema.activityTemplate.name));
  return yield* toTemplateCards(actor.tenantId, rows);
});
