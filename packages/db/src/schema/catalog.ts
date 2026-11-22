import {
  CatalogItemLifecycle,
  INTERACTION_KINDS,
  LEVELS,
  SKILL_DOMAINS,
  type ActivityTemplateId,
  type PersonId,
  type SkillDefinition,
  type SkillId,
  type SkillIndicatorId,
  type SkillResource,
  type SkillVersionId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, oneOf, tenantIdColumn, updatedAt, versionColumn } from './columns.ts';
import { personFk, tenant } from './directory.ts';

/**
 * A skill is a workflow entity (keepers draft, publish, retire). Its published
 * content lives in immutable `skill_version` rows with relational levels and
 * indicators, so observations pin exactly what the observer saw.
 */
export const skill = pgTable(
  'skill',
  {
    id: text('id').$type<SkillId>().primaryKey(),
    tenantId: tenantIdColumn().references(() => tenant.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    summary: text('summary').notNull(),
    domain: text('domain').notNull(),
    /** The business outcome this skill serves, e.g. "client trust". */
    outcome: text('outcome').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Curated level-up playbook resources attached to this skill (levels 1–4). */
    resources: jsonb('resources').$type<ReadonlyArray<SkillResource>>().notNull().default([]),
    status: text('status').notNull().default('draft'),
    /** Keeper's work in progress; becomes a skill_version on PUBLISH. */
    draftDefinition: jsonb('draft_definition').$type<SkillDefinition>(),
    /** FK (tenant_id, id, current_version_id) → skill_version is in the integrity migration (circular). */
    currentVersionId: text('current_version_id').$type<SkillVersionId>(),
    version: versionColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('skill_tenant_id_key').on(t.tenantId, t.id),
    uniqueIndex('skill_tenant_slug_unique').on(t.tenantId, t.slug),
    oneOf('skill_status_check', t.status, CatalogItemLifecycle.states),
    oneOf('skill_domain_check', t.domain, SKILL_DOMAINS),
  ],
);

export const skillFk = (
  name: string,
  tenantColumn: Parameters<typeof foreignKey>[0]['columns'][number],
  column: Parameters<typeof foreignKey>[0]['columns'][number],
) =>
  foreignKey({ name, columns: [tenantColumn, column], foreignColumns: [skill.tenantId, skill.id] });

export const skillVersion = pgTable(
  'skill_version',
  {
    id: text('id').$type<SkillVersionId>().primaryKey(),
    tenantId: tenantIdColumn(),
    skillId: text('skill_id').$type<SkillId>().notNull(),
    number: integer('number').notNull(),
    changeNote: text('change_note'),
    publishedById: text('published_by_id').$type<PersonId>(),
    publishedAt: instant('published_at').notNull(),
  },
  (t) => [
    unique('skill_version_tenant_id_key').on(t.tenantId, t.id),
    unique('skill_version_skill_key').on(t.tenantId, t.skillId, t.id),
    skillFk('skill_version_skill_fk', t.tenantId, t.skillId),
    personFk('skill_version_published_by_fk', t.tenantId, t.publishedById),
    uniqueIndex('skill_version_number_unique').on(t.skillId, t.number),
  ],
);

export const skillLevel = pgTable(
  'skill_level',
  {
    tenantId: tenantIdColumn(),
    skillVersionId: text('skill_version_id').$type<SkillVersionId>().notNull(),
    level: integer('level').notNull(),
    summary: text('summary').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.skillVersionId, t.level] }),
    unique('skill_level_tenant_key').on(t.tenantId, t.skillVersionId, t.level),
    foreignKey({
      name: 'skill_level_version_fk',
      columns: [t.tenantId, t.skillVersionId],
      foreignColumns: [skillVersion.tenantId, skillVersion.id],
    }),
    oneOf('skill_level_level_check', t.level, LEVELS),
  ],
);

/**
 * An observable behavior at a level. `lineage_key` is stable across versions
 * so analytics can follow "the same" indicator as wording evolves.
 */
export const skillIndicator = pgTable(
  'skill_indicator',
  {
    id: text('id').$type<SkillIndicatorId>().primaryKey(),
    tenantId: tenantIdColumn(),
    skillVersionId: text('skill_version_id').$type<SkillVersionId>().notNull(),
    level: integer('level').notNull(),
    lineageKey: text('lineage_key').notNull(),
    text: text('text').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    unique('skill_indicator_tenant_id_key').on(t.tenantId, t.id),
    unique('skill_indicator_version_key').on(t.tenantId, t.skillVersionId, t.id),
    foreignKey({
      name: 'skill_indicator_level_fk',
      columns: [t.tenantId, t.skillVersionId, t.level],
      foreignColumns: [skillLevel.tenantId, skillLevel.skillVersionId, skillLevel.level],
    }),
    uniqueIndex('skill_indicator_lineage_unique').on(t.skillVersionId, t.lineageKey),
    index('skill_indicator_lineage_idx').on(t.tenantId, t.lineageKey),
  ],
);

export const activityTemplate = pgTable(
  'activity_template',
  {
    id: text('id').$type<ActivityTemplateId>().primaryKey(),
    tenantId: tenantIdColumn().references(() => tenant.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    kind: text('kind').notNull(),
    observationTip: text('observation_tip'),
    typicalMinutes: integer('typical_minutes'),
    status: text('status').notNull().default('draft'),
    version: versionColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('activity_template_tenant_id_key').on(t.tenantId, t.id),
    uniqueIndex('activity_template_tenant_slug_unique').on(t.tenantId, t.slug),
    oneOf('activity_template_status_check', t.status, CatalogItemLifecycle.states),
    oneOf('activity_template_kind_check', t.kind, INTERACTION_KINDS),
  ],
);

/** Guidance only: any activity can credit any skill (domain-model.md). */
export const activityTemplateSkill = pgTable(
  'activity_template_skill',
  {
    tenantId: tenantIdColumn(),
    templateId: text('template_id').$type<ActivityTemplateId>().notNull(),
    skillId: text('skill_id').$type<SkillId>().notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.templateId, t.skillId] }),
    foreignKey({
      name: 'activity_template_skill_template_fk',
      columns: [t.tenantId, t.templateId],
      foreignColumns: [activityTemplate.tenantId, activityTemplate.id],
    }),
    skillFk('activity_template_skill_skill_fk', t.tenantId, t.skillId),
    check('activity_template_skill_position', sql`${t.position} >= 0`),
  ],
);
