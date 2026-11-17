import {
  CurrentActor,
  NotFound,
  Unprocessable,
  type Actor,
  type CatalogItemEventType,
  type CatalogTransitionInput,
  type ProgramTemplateDetail,
  type ProgramTemplateRow,
  type TemplateInput,
  type UpdateTemplateInput,
} from '@repo/api';
import {
  ActivityTemplateId,
  CatalogItemLifecycle,
  checkTemplateSkills,
  type CatalogItemStatus,
  type InteractionKind,
  type TemplateSkill,
  type TenantId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { templateSkillViews } from '../shared/catalog.ts';
import { decide, requireUpdated, staleWrite } from '../shared/mutation.ts';
import {
  changeHistory,
  changedFields,
  isProgramAdmin,
  requireProgramAdmin,
  type ChangedValue,
} from './changes.ts';
import { requireReason } from './credit-policy.ts';
import { optionalText, refuseProblems, requireText, uniqueSlug } from './input.ts';

type TemplateRow = typeof schema.activityTemplate.$inferSelect;
type SkillViews = Effect.Success<ReturnType<typeof templateSkillViews>>;
const ENTITY = 'activity_template';
const EVENTS: ReadonlyArray<CatalogItemEventType> = ['PUBLISH', 'RETIRE', 'DISCARD'];

/**
 * A draft template can be published once it lists at least one skill and
 * every skill on it is published. Editing a published template applies at
 * once (to work added afterwards), so a published template has nothing to
 * publish.
 */
const publishable = (row: TemplateRow, skills: ReadonlyArray<{ readonly skillStatus: string }>) =>
  row.status === 'draft' && skills.length > 0 && skills.every((s) => s.skillStatus === 'published');

const toRow = (row: TemplateRow, views: SkillViews): ProgramTemplateRow => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  kind: row.kind as InteractionKind,
  status: row.status as CatalogItemStatus,
  version: row.version,
  skills: (views.get(row.id) ?? []).map((s) => ({
    ...s,
    skillStatus: s.skillStatus as CatalogItemStatus,
  })),
  typicalMinutes: row.typicalMinutes,
  updatedAt: row.updatedAt.toISOString(),
});

const loadTemplate = Effect.fn('program.loadTemplate')(function* (
  tenantId: TenantId,
  id: ActivityTemplateId,
) {
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.activityTemplate)
    .where(and(eq(schema.activityTemplate.tenantId, tenantId), eq(schema.activityTemplate.id, id)));
  if (!row) return yield* Effect.fail(new NotFound({ entity: 'activity template', id }));
  return row;
});

const buildDetail = Effect.fn('program.templateDetail')(function* (actor: Actor, row: TemplateRow) {
  const views = yield* templateSkillViews(actor.tenantId, [row.id]);
  const admin = isProgramAdmin(actor);
  return {
    ...toRow(row, views),
    description: row.description,
    observationTip: row.observationTip,
    actions: admin
      ? [
          ...CatalogItemLifecycle.allowed(
            row.status as CatalogItemStatus,
            { complete: publishable(row, views.get(row.id) ?? []) },
            EVENTS.map((type) => ({ type })),
          ),
        ]
      : [],
    canEdit: admin && !CatalogItemLifecycle.isTerminal(row.status as CatalogItemStatus),
    history: yield* changeHistory(actor.tenantId, ENTITY, row.id),
  } satisfies ProgramTemplateDetail;
});

const reloadDetail = Effect.fn('program.reloadTemplate')(function* (
  actor: Actor,
  id: ActivityTemplateId,
) {
  return yield* buildDetail(actor, yield* loadTemplate(actor.tenantId, id));
});

/** `GET /program/activity-templates`: every template in any state, with its skills, roles and values. */
export const listTemplates = Effect.fn('program.templates')(function* () {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.activityTemplate)
    .where(eq(schema.activityTemplate.tenantId, actor.tenantId))
    .orderBy(asc(schema.activityTemplate.name));
  const views = yield* templateSkillViews(
    actor.tenantId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toRow(r, views));
});

/** `GET /program/activity-templates/:id`. */
export const readTemplate = Effect.fn('program.template')(function* (id: ActivityTemplateId) {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  return yield* reloadDetail(actor, id);
});

/**
 * A template's fields, checked: bounded text, a typical length in minutes,
 * and its skills (each once, at most one primary, values in range, every
 * skill published in this tenant).
 */
const checkedInput = Effect.fn('program.templateInput')(function* (
  tenantId: TenantId,
  input: TemplateInput,
) {
  const minutes = input.typicalMinutes;
  if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 600))
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Use a whole number of minutes from 1 to 600, or leave it empty.',
        field: 'typicalMinutes',
      }),
    );
  const skills: ReadonlyArray<TemplateSkill> = input.skills;
  yield* refuseProblems(checkTemplateSkills(skills));
  const slugs = new Map<string, string>();
  if (skills.length > 0) {
    const db = yield* Db;
    const published = yield* db
      .select({ id: schema.skill.id, slug: schema.skill.slug })
      .from(schema.skill)
      .where(
        and(
          eq(schema.skill.tenantId, tenantId),
          inArray(
            schema.skill.id,
            skills.map((s) => s.skillId),
          ),
          eq(schema.skill.status, 'published'),
        ),
      );
    if (published.length !== skills.length)
      return yield* Effect.fail(
        new Unprocessable({
          message: 'Choose skills from the published catalog; remove any that were retired.',
          field: 'skills',
        }),
      );
    for (const p of published) slugs.set(p.id, p.slug);
  }
  return {
    name: yield* requireText(input.name, 'name', 'The name', { min: 2, max: 120 }),
    description: yield* requireText(input.description, 'description', 'The description', {
      min: 10,
      max: 600,
    }),
    kind: input.kind,
    observationTip: yield* optionalText(input.observationTip, 'observationTip', 'The tip', 600),
    typicalMinutes: minutes,
    skills,
    slugs,
  };
});

type Checked = Effect.Success<ReturnType<typeof checkedInput>>;

/** "client-discovery primary 8; explaining-simply secondary", for the before-and-after record. */
const skillsText = (skills: ReadonlyArray<{ slug: string; role: string; points: number | null }>) =>
  skills.map((s) => `${s.slug} ${s.role}${s.points === null ? '' : ` ${s.points}`}`).join('; ');

const record = (
  t: Omit<Checked, 'skills' | 'slugs'>,
  skills: ReadonlyArray<{ slug: string; role: string; points: number | null }>,
) =>
  ({
    name: t.name,
    description: t.description,
    kind: t.kind,
    observationTip: t.observationTip,
    typicalMinutes: t.typicalMinutes,
    skills: skillsText(skills),
  }) satisfies Record<string, ChangedValue>;

const withSlugs = (skills: ReadonlyArray<TemplateSkill>, slugs: ReadonlyMap<string, string>) =>
  skills.map((s) => ({ slug: slugs.get(s.skillId) ?? s.skillId, role: s.role, points: s.points }));

const writeSkills = Effect.fn('program.writeTemplateSkills')(function* (
  tenantId: TenantId,
  templateId: ActivityTemplateId,
  skills: ReadonlyArray<TemplateSkill>,
) {
  const db = yield* Db;
  yield* db
    .delete(schema.activityTemplateSkill)
    .where(
      and(
        eq(schema.activityTemplateSkill.tenantId, tenantId),
        eq(schema.activityTemplateSkill.templateId, templateId),
      ),
    );
  if (skills.length === 0) return;
  yield* db.insert(schema.activityTemplateSkill).values(
    skills.map((s, position) => ({
      tenantId,
      templateId,
      skillId: s.skillId,
      position,
      role: s.role,
      points: s.points,
    })),
  );
});

/** `POST /program/activity-templates`: a new draft template. */
export const createTemplate = Effect.fn('program.createTemplate')(function* (input: TemplateInput) {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  const { skills, slugs, ...fields } = yield* checkedInput(actor.tenantId, input);
  const db = yield* Db;
  const slug = yield* uniqueSlug(actor.tenantId, 'activityTemplate', fields.name);
  const id = ActivityTemplateId.generate();
  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.activityTemplate).values({
        id,
        tenantId: actor.tenantId,
        slug,
        ...fields,
        status: 'draft',
      });
      yield* writeSkills(actor.tenantId, id, skills);
      yield* recordAudit(actor, {
        entityType: ENTITY,
        reasonCode: 'catalog_change',
        entityId: id,
        event: 'CREATE',
        to: 'draft',
        data: { changes: changedFields({}, record(fields, withSlugs(skills, slugs))) },
      });
    }),
  );
  return yield* reloadDetail(actor, id);
});

/**
 * `PUT /program/activity-templates/:id`: edits a draft or published template,
 * audited with before and after. Roles and values are copied onto an activity
 * when work is added, so an edit affects only work added afterwards. Changing
 * the skills, their roles or their values needs a reason, as skill values and
 * the credit rules do.
 */
export const updateTemplate = Effect.fn('program.updateTemplate')(function* (
  id: ActivityTemplateId,
  input: UpdateTemplateInput,
) {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  const row = yield* loadTemplate(actor.tenantId, id);
  if (CatalogItemLifecycle.isTerminal(row.status as CatalogItemStatus))
    return yield* Effect.fail(
      new Unprocessable({ message: `This template is ${row.status}; it can no longer change.` }),
    );
  if (row.version !== input.version) return yield* Effect.fail(staleWrite('template'));
  const { skills, slugs, ...fields } = yield* checkedInput(actor.tenantId, input);
  const before = (yield* templateSkillViews(actor.tenantId, [id])).get(id) ?? [];
  const skillsBefore = before.map((s) => ({ slug: s.skill.slug, role: s.role, points: s.points }));
  const valuesChanged = skillsText(skillsBefore) !== skillsText(withSlugs(skills, slugs));
  const reason = valuesChanged
    ? yield* requireReason(input.reason ?? '')
    : input.reason?.trim() || null;
  const db = yield* Db;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.activityTemplate)
        .set({ ...fields, version: row.version + 1, updatedAt: yield* now })
        .where(
          and(
            eq(schema.activityTemplate.tenantId, actor.tenantId),
            eq(schema.activityTemplate.id, row.id),
            eq(schema.activityTemplate.version, row.version),
          ),
        )
        .returning({ id: schema.activityTemplate.id })
        .pipe(Effect.flatMap(requireUpdated('template')));
      yield* writeSkills(actor.tenantId, id, skills);
      yield* recordAudit(actor, {
        entityType: ENTITY,
        reasonCode: 'catalog_change',
        entityId: id,
        event: 'UPDATE',
        from: row.status,
        to: row.status,
        ...(reason && { note: { kind: 'catalog_change' as const, body: reason } }),
        data: {
          changes: changedFields(
            record(
              {
                name: row.name,
                description: row.description,
                kind: row.kind as InteractionKind,
                observationTip: row.observationTip,
                typicalMinutes: row.typicalMinutes,
              },
              skillsBefore,
            ),
            record(fields, withSlugs(skills, slugs)),
          ),
        },
      });
    }),
  );
  return yield* reloadDetail(actor, id);
});

/** `POST /program/activity-templates/:id/transition`: publish a draft, retire, or discard a draft. */
export const templateTransition = Effect.fn('program.templateTransition')(function* (
  id: ActivityTemplateId,
  input: CatalogTransitionInput,
) {
  const actor = yield* CurrentActor;
  const row = yield* loadTemplate(actor.tenantId, id);
  const skills = (yield* templateSkillViews(actor.tenantId, [id])).get(id) ?? [];
  const from = row.status as CatalogItemStatus;
  const to = yield* decide({
    lifecycle: CatalogItemLifecycle,
    from,
    facts: { complete: publishable(row, skills) },
    event: { type: input.event },
    permitted: isProgramAdmin(actor),
    forbiddenMessage: 'Only program owners and tenant admins can change the catalog.',
    ...(input.event === 'PUBLISH' &&
      from === 'draft' && {
        explain: 'List at least one skill, all of them published, before publishing.',
      }),
  });
  if (row.version !== input.version) return yield* Effect.fail(staleWrite('template'));
  const note = input.note?.trim() || null;
  const db = yield* Db;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.activityTemplate)
        .set({ status: to, version: row.version + 1, updatedAt: yield* now })
        .where(
          and(
            eq(schema.activityTemplate.tenantId, actor.tenantId),
            eq(schema.activityTemplate.id, row.id),
            eq(schema.activityTemplate.version, row.version),
          ),
        )
        .returning({ id: schema.activityTemplate.id })
        .pipe(Effect.flatMap(requireUpdated('template')));
      yield* recordAudit(actor, {
        entityType: ENTITY,
        reasonCode: 'catalog_change',
        entityId: id,
        event: input.event,
        from,
        to,
        data: { changes: [{ field: 'status', before: from, after: to }] },
        ...(note && { note: { kind: 'catalog_change' as const, body: note } }),
      });
    }),
  );
  return yield* reloadDetail(actor, id);
});
