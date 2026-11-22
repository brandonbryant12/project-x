import {
  CurrentActor,
  NotFound,
  type CatalogInsights,
  type SkillCard,
  type SkillCombo,
  type TemplateCard,
} from '@repo/api';
import {
  computeCatalogInsights,
  extractDisplayTags,
  LEVEL_NAMES,
  rarePairingsForSkill,
  skillTierFromTags,
  type InteractionKind,
  type Level,
  type PersonId,
  type RareComboInsight,
  type SkillDomain,
  type SkillId,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { loadDefinitions, loadTemplateSkills } from '../shared/catalog-reads.ts';
import { loadPeople, personFrom } from '../shared/people.ts';
import { currentPlanSkillIds } from '../shared/plans.ts';
import { progressFor } from '../shared/recognition.ts';
import { loadSkills, refsFor, toSkillRef } from '../shared/skills.ts';

interface SkillsQuery {
  readonly q?: string | undefined;
  readonly domain?: SkillDomain | undefined;
}

const loadCatalogSignals = Effect.fn('catalog.loadSignals')(function* (tenantId: TenantId) {
  const db = yield* Db;
  const [allSkills, badges, activeFocuses, activePeople] = yield* Effect.all([
    db
      .select()
      .from(schema.skill)
      .where(and(eq(schema.skill.tenantId, tenantId), eq(schema.skill.status, 'published')))
      .orderBy(asc(schema.skill.name)),
    db
      .select({
        skillId: schema.badgeAward.skillId,
        personId: schema.badgeAward.personId,
        level: schema.badgeAward.level,
      })
      .from(schema.badgeAward)
      .where(
        and(eq(schema.badgeAward.tenantId, tenantId), eq(schema.badgeAward.status, 'awarded')),
      ),
    db
      .select({
        skillId: schema.planSkill.skillId,
        personId: schema.plan.ownerId,
      })
      .from(schema.planSkill)
      .innerJoin(
        schema.plan,
        and(
          eq(schema.plan.tenantId, schema.planSkill.tenantId),
          eq(schema.plan.id, schema.planSkill.planId),
        ),
      )
      .where(and(eq(schema.planSkill.tenantId, tenantId), eq(schema.plan.status, 'active'))),
    db
      .select({ id: schema.person.id })
      .from(schema.person)
      .where(and(eq(schema.person.tenantId, tenantId), eq(schema.person.status, 'active'))),
  ]);
  return { allSkills, badges, activeFocuses, totalPeople: activePeople.length };
});

const toSkillCombos = (
  combos: ReadonlyArray<RareComboInsight>,
  skillMap: ReadonlyMap<SkillId, typeof schema.skill.$inferSelect>,
): ReadonlyArray<SkillCombo> =>
  combos.flatMap((c): ReadonlyArray<SkillCombo> => {
    const a = skillMap.get(c.skillIds[0]);
    const b = skillMap.get(c.skillIds[1]);
    if (!a || !b) return [];
    return [
      {
        skills: [toSkillRef(a), toSkillRef(b)],
        jointHolders: c.jointHolders,
        matchesViewer: c.matchesViewer,
        viewerHeldSkillId: c.viewerHeldSkillId,
        rationale: c.rationale,
      },
    ];
  });

const toTemplateCards = Effect.fn('catalog.templateCards')(function* (
  tenantId: TenantId,
  rows: ReadonlyArray<typeof schema.activityTemplate.$inferSelect>,
) {
  const suggested = yield* loadTemplateSkills(
    tenantId,
    rows.map((r) => r.id),
  );
  const skills = yield* loadSkills(tenantId, [...suggested.values()].flat());
  return rows.map((r): TemplateCard => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    kind: r.kind as InteractionKind,
    suggestedSkills: refsFor(skills, suggested.get(r.id) ?? []),
    typicalMinutes: r.typicalMinutes,
    observationTip: r.observationTip,
  }));
});

/** `GET /catalog/skills`: published skills with tier, tags, firm signals, and caller ring standing. */
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
  const [rows, signals, inPlan] = yield* Effect.all([
    db
      .select()
      .from(schema.skill)
      .where(and(...conditions))
      .orderBy(asc(schema.skill.name)),
    loadCatalogSignals(actor.tenantId),
    currentPlanSkillIds(actor.tenantId, actor.personId),
  ]);
  const insights = computeCatalogInsights({
    skills: signals.allSkills.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain as SkillDomain,
      tags: s.tags,
    })),
    badges: signals.badges,
    activeFocuses: signals.activeFocuses,
    viewerPersonId: actor.personId,
  });
  const progresses = yield* progressFor(
    actor.tenantId,
    actor.personId,
    rows.map((r) => r.id),
  );
  const progressBySkill = new Map(progresses.map((p) => [p.skill.id, p]));

  return rows.map((row): SkillCard => {
    const metric = insights.metrics.get(row.id);
    const mine = signals.badges
      .filter((s) => s.skillId === row.id && s.personId === actor.personId)
      .map((s) => s.level);
    const prog = progressBySkill.get(row.id);
    const primary = prog?.criteria[0];
    return {
      ...toSkillRef(row),
      summary: row.summary,
      outcome: row.outcome,
      tier: metric?.tier ?? skillTierFromTags(row.tags),
      tags: metric?.displayTags ?? extractDisplayTags(row.tags),
      holderCount: metric?.holderCount ?? 0,
      activeFocusCount: metric?.activeFocusCount ?? 0,
      signal: metric?.signal ?? 'balanced',
      inMyPlan: inPlan.has(row.id),
      myHighestLevel: mine.length > 0 ? Math.max(...mine) : null,
      myCurrent: primary?.current ?? 0,
      myRequired: primary?.required ?? 0,
    };
  });
});

/** `GET /catalog/insights`: popular skills, firm gaps, personalized rare combos, and tag facets. */
export const buildCatalogInsights = Effect.fn('catalog.insights')(function* () {
  const actor = yield* CurrentActor;
  const signals = yield* loadCatalogSignals(actor.tenantId);
  const insights = computeCatalogInsights({
    skills: signals.allSkills.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain as SkillDomain,
      tags: s.tags,
    })),
    badges: signals.badges,
    activeFocuses: signals.activeFocuses,
    viewerPersonId: actor.personId,
  });
  const skillMap = new Map(signals.allSkills.map((s) => [s.id, s]));
  return {
    totalPeople: signals.totalPeople,
    popularSkillIds: insights.popularSkillIds,
    lackingSkillIds: insights.lackingSkillIds,
    rareCombos: toSkillCombos(insights.rareCombos, skillMap),
    tags: insights.tagCounts,
  } satisfies CatalogInsights;
});

/** `GET /catalog/skills/:slug`: current version's levels, holders, templates, standing, and rare pairings. */
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
  const [definitions, signals, templates, inPlan, [progress]] = yield* Effect.all([
    loadDefinitions(actor.tenantId, [version.id]),
    loadCatalogSignals(actor.tenantId),
    db
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
      .pipe(Effect.map((rs) => rs.map((r) => r.template))),
    currentPlanSkillIds(actor.tenantId, actor.personId),
    progressFor(actor.tenantId, actor.personId, [row.id]),
  ]);

  const skillInputs = signals.allSkills.map((s) => ({
    id: s.id,
    name: s.name,
    domain: s.domain as SkillDomain,
    tags: s.tags,
  }));
  const insights = computeCatalogInsights({
    skills: skillInputs,
    badges: signals.badges,
    activeFocuses: signals.activeFocuses,
    viewerPersonId: actor.personId,
  });
  const pairings = rarePairingsForSkill(row.id, {
    skills: skillInputs,
    badges: signals.badges,
    viewerPersonId: actor.personId,
  });
  const skillMap = new Map(signals.allSkills.map((s) => [s.id, s]));
  const metric = insights.metrics.get(row.id);

  const highest = new Map<PersonId, number>();
  for (const s of signals.badges) {
    if (s.skillId !== row.id) continue;
    highest.set(s.personId, Math.max(highest.get(s.personId) ?? 0, s.level));
  }
  const people = yield* loadPeople(actor.tenantId, [...highest.keys()]);
  const mine = highest.get(actor.personId) ?? null;
  const primary = progress?.criteria[0];

  return {
    ...toSkillRef(row),
    summary: row.summary,
    outcome: row.outcome,
    tier: metric?.tier ?? skillTierFromTags(row.tags),
    tags: metric?.displayTags ?? extractDisplayTags(row.tags),
    holderCount: highest.size,
    activeFocusCount: metric?.activeFocusCount ?? 0,
    signal: metric?.signal ?? 'balanced',
    inMyPlan: inPlan.has(row.id),
    myHighestLevel: mine,
    myCurrent: primary?.current ?? 0,
    myRequired: primary?.required ?? 0,
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
    rarePairings: toSkillCombos(pairings, skillMap),
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
