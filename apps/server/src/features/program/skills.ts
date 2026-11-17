import {
  CurrentActor,
  NotFound,
  Unprocessable,
  type Actor,
  type CatalogItemEventType,
  type CatalogTransitionInput,
  type LevelDraftView,
  type ProgramSkillDetail,
  type ProgramSkillRow,
  type SetSkillValuesInput,
  type SkillDetailsInput,
  type TenantValuesView,
  type UpdateSkillInput,
} from '@repo/api';
import {
  CatalogItemLifecycle,
  LEVELS,
  SkillId,
  SkillIndicatorId,
  checkSkillValues,
  isDefinitionComplete,
  lineageChanges,
  prepareDefinition,
  type CatalogItemStatus,
  type PreparedLevel,
  type SkillDefinition,
  type SkillDomain,
  type SkillVersionId,
  type TenantId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, asc, desc, eq, inArray, max, ne } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { insertSkillVersion } from '../shared/catalog.ts';
import { loadDefinitions } from '../shared/catalog-reads.ts';
import { loadPeople } from '../shared/people.ts';
import { inspectTenantCreditPolicy } from '../shared/recognition.ts';
import { decide, requireUpdated, staleWrite } from '../shared/mutation.ts';
import {
  changeHistory,
  changedFields,
  isProgramAdmin,
  requireProgramAdmin,
  type ChangedValue,
} from './changes.ts';
import { requireReason } from './credit-policy.ts';
import { problemError, refuseProblems, requireText, uniqueSlug } from './input.ts';

type SkillRow = typeof schema.skill.$inferSelect;
const ENTITY = 'skill';
const EVENTS: ReadonlyArray<CatalogItemEventType> = ['PUBLISH', 'RETIRE', 'DISCARD'];

/** The tenant's values a skill falls back to; null while the stored policy is broken. */
const tenantValues = Effect.fn('program.tenantValues')(function* (tenantId: TenantId) {
  const { reading } = yield* inspectTenantCreditPolicy(tenantId);
  if (!reading.ok) return null satisfies TenantValuesView;
  const { primaryPoints, secondaryPoints, badgePoints, minPrimaryPoints } = reading.policy;
  return { primaryPoints, secondaryPoints, badgePoints, minPrimaryPoints };
});

const versionNumbers = Effect.fn('program.versionNumbers')(function* (
  tenantId: TenantId,
  ids: ReadonlyArray<SkillVersionId>,
) {
  if (ids.length === 0) return new Map<SkillVersionId, number>();
  const db = yield* Db;
  const rows = yield* db
    .select({ id: schema.skillVersion.id, number: schema.skillVersion.number })
    .from(schema.skillVersion)
    .where(
      and(eq(schema.skillVersion.tenantId, tenantId), inArray(schema.skillVersion.id, [...ids])),
    );
  return new Map(rows.map((r) => [r.id, r.number]));
});

/** The draft's content for publishing: what the editor saved, with its lineage keys. */
const draftLevels = (definition: SkillDefinition | null): Array<PreparedLevel> | null =>
  definition
    ? definition.levels.map((l) => ({
        level: l.level,
        summary: l.summary,
        indicators: l.indicators.map((i) => ({ lineageKey: i.lineageKey, text: i.text })),
      }))
    : null;

/** Stored drafts carry placeholder indicator ids; a published version gets fresh ones. */
const toStoredDraft = (levels: ReadonlyArray<PreparedLevel>): SkillDefinition => ({
  levels: levels.map((l) => ({
    level: l.level,
    summary: l.summary,
    indicators: l.indicators.map((i) => ({ id: SkillIndicatorId.generate(), ...i })),
  })),
});

/** "4 levels · 11 indicators", for the before-and-after record. */
const describeDraft = (levels: ReadonlyArray<PreparedLevel> | null): string | null =>
  levels
    ? `${levels.length} levels · ${levels.reduce((n, l) => n + l.indicators.length, 0)} indicators`
    : null;

const sameDraft = (
  a: ReadonlyArray<PreparedLevel> | null,
  b: ReadonlyArray<PreparedLevel> | null,
) => JSON.stringify(a) === JSON.stringify(b);

const isComplete = (row: SkillRow) =>
  row.draftDefinition !== null && isDefinitionComplete(row.draftDefinition);

const actionsFor = (actor: Actor, row: SkillRow): Array<CatalogItemEventType> =>
  isProgramAdmin(actor)
    ? [
        ...CatalogItemLifecycle.allowed(
          row.status as CatalogItemStatus,
          { complete: isComplete(row) },
          EVENTS.map((type) => ({ type })),
        ),
      ]
    : [];

const toRow = (row: SkillRow, currentVersion: number | null): ProgramSkillRow => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  domain: row.domain as SkillDomain,
  summary: row.summary,
  status: row.status as CatalogItemStatus,
  version: row.version,
  currentVersion,
  hasDraft: row.draftDefinition !== null,
  values: {
    primaryPoints: row.primaryPoints,
    secondaryPoints: row.secondaryPoints,
    badgePoints: row.badgePoints,
    minPrimaryPoints: row.minPrimaryPoints,
  },
  updatedAt: row.updatedAt.toISOString(),
});

const loadSkill = Effect.fn('program.loadSkill')(function* (tenantId: TenantId, slug: string) {
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.skill)
    .where(and(eq(schema.skill.tenantId, tenantId), eq(schema.skill.slug, slug)));
  if (!row) return yield* Effect.fail(new NotFound({ entity: 'skill', id: slug }));
  return row;
});

const buildDetail = Effect.fn('program.skillDetail')(function* (actor: Actor, row: SkillRow) {
  const db = yield* Db;
  const versions = yield* db
    .select()
    .from(schema.skillVersion)
    .where(
      and(
        eq(schema.skillVersion.tenantId, actor.tenantId),
        eq(schema.skillVersion.skillId, row.id),
      ),
    )
    .orderBy(desc(schema.skillVersion.number));
  const current = versions.find((v) => v.id === row.currentVersionId) ?? null;
  const definitions = yield* loadDefinitions(actor.tenantId, current ? [current.id] : []);
  const people = yield* loadPeople(
    actor.tenantId,
    versions.flatMap((v) => (v.publishedById ? [v.publishedById] : [])),
  );
  const templates = yield* db
    .select({
      id: schema.activityTemplate.id,
      name: schema.activityTemplate.name,
      status: schema.activityTemplate.status,
    })
    .from(schema.activityTemplate)
    .innerJoin(
      schema.activityTemplateSkill,
      and(
        eq(schema.activityTemplateSkill.tenantId, schema.activityTemplate.tenantId),
        eq(schema.activityTemplateSkill.templateId, schema.activityTemplate.id),
      ),
    )
    .where(
      and(
        eq(schema.activityTemplate.tenantId, actor.tenantId),
        eq(schema.activityTemplateSkill.skillId, row.id),
        ne(schema.activityTemplate.status, 'discarded'),
      ),
    )
    .orderBy(asc(schema.activityTemplate.name));
  const draft = draftLevels(row.draftDefinition);
  return {
    ...toRow(row, current?.number ?? null),
    outcome: row.outcome,
    tags: row.tags,
    draft: draft?.map((l): LevelDraftView => ({ ...l, indicators: [...l.indicators] })) ?? null,
    draftComplete: isComplete(row),
    published: current ? (definitions.get(current.id)?.levels ?? []) : [],
    versions: versions.map((v) => ({
      number: v.number,
      publishedAt: v.publishedAt.toISOString(),
      publishedBy: v.publishedById ? (people.get(v.publishedById) ?? null) : null,
      changeNote: v.changeNote,
    })),
    tenantValues: yield* tenantValues(actor.tenantId),
    templates: templates.map((t) => ({ ...t, status: t.status as CatalogItemStatus })),
    actions: actionsFor(actor, row),
    canEdit:
      isProgramAdmin(actor) && !CatalogItemLifecycle.isTerminal(row.status as CatalogItemStatus),
    history: yield* changeHistory(actor.tenantId, ENTITY, row.id),
  } satisfies ProgramSkillDetail;
});

const reloadDetail = Effect.fn('program.reloadSkill')(function* (actor: Actor, slug: string) {
  return yield* buildDetail(actor, yield* loadSkill(actor.tenantId, slug));
});

/** `GET /program/skills`: every skill in any state, with its published version and own values. */
export const listSkills = Effect.fn('program.skills')(function* () {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.skill)
    .where(eq(schema.skill.tenantId, actor.tenantId))
    .orderBy(asc(schema.skill.name));
  const numbers = yield* versionNumbers(
    actor.tenantId,
    rows.flatMap((r) => (r.currentVersionId ? [r.currentVersionId] : [])),
  );
  return {
    tenantValues: yield* tenantValues(actor.tenantId),
    skills: rows.map((r) =>
      toRow(r, r.currentVersionId ? (numbers.get(r.currentVersionId) ?? null) : null),
    ),
  };
});

/** `GET /program/skills/:slug`. */
export const readSkill = Effect.fn('program.skill')(function* (slug: string) {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  return yield* reloadDetail(actor, slug);
});

const checkedDetails = Effect.fn('program.skillDetails')(function* (input: SkillDetailsInput) {
  const tags = [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (tags.length > 10)
    return yield* Effect.fail(
      new Unprocessable({ message: 'Use at most 10 tags.', field: 'tags' }),
    );
  return {
    name: yield* requireText(input.name, 'name', 'The name', { min: 2, max: 120 }),
    summary: yield* requireText(input.summary, 'summary', 'The summary', { min: 10, max: 600 }),
    outcome: yield* requireText(input.outcome, 'outcome', 'The outcome', { min: 2, max: 120 }),
    domain: input.domain,
    tags,
  };
});

const detailsRecord = (d: {
  readonly name: string;
  readonly summary: string;
  readonly outcome: string;
  readonly domain: string;
  readonly tags: ReadonlyArray<string>;
}): Record<string, ChangedValue> => ({
  name: d.name,
  summary: d.summary,
  domain: d.domain,
  outcome: d.outcome,
  tags: d.tags.join(', '),
});

const emptyDraft = (): Array<PreparedLevel> =>
  LEVELS.map((level) => ({ level, summary: '', indicators: [] }));

/** `POST /program/skills`: a new draft with four empty levels, under a slug no other skill has. */
export const createSkill = Effect.fn('program.createSkill')(function* (input: SkillDetailsInput) {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  const details = yield* checkedDetails(input);
  const db = yield* Db;
  const slug = yield* uniqueSlug(actor.tenantId, 'skill', details.name);
  const id = SkillId.generate();
  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.skill).values({
        id,
        tenantId: actor.tenantId,
        slug,
        ...details,
        status: 'draft',
        draftDefinition: toStoredDraft(emptyDraft()),
      });
      yield* recordAudit(actor, {
        entityType: ENTITY,
        reasonCode: 'catalog_change',
        entityId: id,
        event: 'CREATE',
        to: 'draft',
        data: { changes: changedFields({}, detailsRecord(details)) },
      });
    }),
  );
  return yield* reloadDetail(actor, slug);
});

const requireEditable = (row: SkillRow, version: number) => {
  if (CatalogItemLifecycle.isTerminal(row.status as CatalogItemStatus))
    return Effect.fail(
      new Unprocessable({ message: `This skill is ${row.status}; it can no longer change.` }),
    );
  return row.version === version ? Effect.void : Effect.fail(staleWrite('skill'));
};

/**
 * `PUT /program/skills/:slug`: a draft's or published skill's details and its
 * draft definition. Observers keep seeing the published version until the
 * draft is published as the next one.
 */
export const updateSkill = Effect.fn('program.updateSkill')(function* (
  slug: string,
  input: UpdateSkillInput,
) {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  const row = yield* loadSkill(actor.tenantId, slug);
  yield* requireEditable(row, input.version);
  const details = yield* checkedDetails(input);
  let draft: ReadonlyArray<PreparedLevel> | null = null;
  if (input.definition) {
    const prepared = prepareDefinition(input.definition);
    if (!prepared.ok) return yield* Effect.fail(problemError(prepared.problems));
    draft = prepared.levels;
  }
  const before = draftLevels(row.draftDefinition);
  const draftChanged = !sameDraft(before, draft);
  const changes = [
    ...changedFields(detailsRecord(row), detailsRecord(details)),
    ...(draftChanged
      ? [{ field: 'draft', before: describeDraft(before), after: describeDraft(draft) }]
      : []),
  ];
  const db = yield* Db;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.skill)
        .set({
          ...details,
          ...(draftChanged && { draftDefinition: draft ? toStoredDraft(draft) : null }),
          version: row.version + 1,
          updatedAt: yield* now,
        })
        .where(and(eq(schema.skill.id, row.id), eq(schema.skill.version, row.version)))
        .returning({ id: schema.skill.id })
        .pipe(Effect.flatMap(requireUpdated('skill')));
      yield* recordAudit(actor, {
        entityType: ENTITY,
        reasonCode: 'catalog_change',
        entityId: row.id,
        event: 'UPDATE',
        from: row.status,
        to: row.status,
        data: { changes },
      });
    }),
  );
  return yield* reloadDetail(actor, slug);
});

/**
 * `PUT /program/skills/:slug/values`: the skill's own points and badge values
 * (null uses the tenant's), with a reason. Applies to credit signed from now
 * on; credit already signed keeps the value frozen on it.
 */
export const setSkillValues = Effect.fn('program.setSkillValues')(function* (
  slug: string,
  input: SetSkillValuesInput,
) {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  const row = yield* loadSkill(actor.tenantId, slug);
  yield* requireEditable(row, input.version);
  yield* refuseProblems(checkSkillValues(input.values));
  const reason = yield* requireReason(input.reason);
  const before = {
    primaryPoints: row.primaryPoints,
    secondaryPoints: row.secondaryPoints,
    badgePoints: row.badgePoints,
    minPrimaryPoints: row.minPrimaryPoints,
  };
  const db = yield* Db;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.skill)
        .set({ ...input.values, version: row.version + 1, updatedAt: yield* now })
        .where(and(eq(schema.skill.id, row.id), eq(schema.skill.version, row.version)))
        .returning({ id: schema.skill.id })
        .pipe(Effect.flatMap(requireUpdated('skill')));
      yield* recordAudit(actor, {
        entityType: ENTITY,
        reasonCode: 'catalog_change',
        entityId: row.id,
        event: 'SET_VALUES',
        from: row.status,
        to: row.status,
        note: { kind: 'catalog_change', body: reason },
        data: { changes: changedFields(before, { ...input.values }) },
      });
    }),
  );
  return yield* reloadDetail(actor, slug);
});

const explainRefusal = (row: SkillRow, event: CatalogItemEventType) => {
  if (event !== 'PUBLISH' || CatalogItemLifecycle.isTerminal(row.status as CatalogItemStatus))
    return undefined;
  return row.draftDefinition === null
    ? 'There are no changes to publish.'
    : 'Each of the four levels needs a summary and at least one indicator before it can be published.';
};

/**
 * `POST /program/skills/:slug/transition`. PUBLISH writes the draft as the
 * next immutable version (version 1 on first publication), points the skill
 * at it and clears the draft; observations already made keep the version they
 * pinned. RETIRE stops new use (plans, activities and observations require a
 * published skill) while history still shows it. DISCARD drops a draft.
 */
export const skillTransition = Effect.fn('program.skillTransition')(function* (
  slug: string,
  input: CatalogTransitionInput,
) {
  const actor = yield* CurrentActor;
  const row = yield* loadSkill(actor.tenantId, slug);
  const from = row.status as CatalogItemStatus;
  const explain = explainRefusal(row, input.event);
  const to = yield* decide({
    lifecycle: CatalogItemLifecycle,
    from,
    facts: { complete: isComplete(row) },
    event: { type: input.event },
    permitted: isProgramAdmin(actor),
    forbiddenMessage: 'Only program owners and tenant admins can change the catalog.',
    ...(explain && { explain }),
  });
  if (row.version !== input.version) return yield* Effect.fail(staleWrite('skill'));
  const note = input.note?.trim() || null;
  const db = yield* Db;
  const at = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      const levels = draftLevels(row.draftDefinition);
      let published: { versionId: SkillVersionId; number: number } | null = null;
      if (input.event === 'PUBLISH' && levels) {
        const [latest] = yield* db
          .select({ number: max(schema.skillVersion.number) })
          .from(schema.skillVersion)
          .where(
            and(
              eq(schema.skillVersion.tenantId, actor.tenantId),
              eq(schema.skillVersion.skillId, row.id),
            ),
          );
        const number = (latest?.number ?? 0) + 1;
        const previous = row.currentVersionId
          ? ((yield* loadDefinitions(actor.tenantId, [row.currentVersionId])).get(
              row.currentVersionId,
            )?.levels ?? [])
          : [];
        const versionId = yield* insertSkillVersion({
          tenantId: actor.tenantId,
          skillId: row.id,
          number,
          levels,
          publishedById: actor.personId,
          publishedAt: at,
          changeNote: note,
        });
        published = { versionId, number };
        yield* recordAudit(actor, {
          entityType: ENTITY,
          reasonCode: 'catalog_change',
          entityId: row.id,
          event: 'PUBLISH',
          from,
          to,
          data: {
            versionId,
            lineage: lineageChanges(previous, levels),
            changes: [{ field: 'version', before: number - 1 || null, after: number }],
          },
          ...(note && { note: { kind: 'catalog_change' as const, body: note } }),
        });
      } else {
        yield* recordAudit(actor, {
          entityType: ENTITY,
          reasonCode: 'catalog_change',
          entityId: row.id,
          event: input.event,
          from,
          to,
          data: { changes: [{ field: 'status', before: from, after: to }] },
          ...(note && { note: { kind: 'catalog_change' as const, body: note } }),
        });
      }
      yield* db
        .update(schema.skill)
        .set({
          status: to,
          ...(published && { currentVersionId: published.versionId, draftDefinition: null }),
          version: row.version + 1,
          updatedAt: at,
        })
        .where(and(eq(schema.skill.id, row.id), eq(schema.skill.version, row.version)))
        .returning({ id: schema.skill.id })
        .pipe(Effect.flatMap(requireUpdated('skill')));
    }),
  );
  return yield* reloadDetail(actor, slug);
});
