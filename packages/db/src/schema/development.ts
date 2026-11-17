import {
  ACTIVITY_ORIGINS,
  CURRENT_PLAN_STATES,
  OBSERVATION_MODES,
  ActivityLifecycle,
  EvidenceLifecycle,
  INTERACTION_KINDS,
  LEVELS,
  PlanLifecycle,
  type ActivityId,
  type ActivityTemplateId,
  type EvidenceId,
  type InteractionId,
  type PersonId,
  type PlanId,
  type SkillId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { activityTemplate, skillFk } from './catalog.ts';
import {
  createdAt,
  inList,
  instant,
  isoDate,
  oneOf,
  oneOfOrNull,
  profileKeyCheck,
  profileKeyColumn,
  tenantIdColumn,
  updatedAt,
  versionColumn,
} from './columns.ts';
import { personFk } from './directory.ts';

export const PLAN_OUTCOMES = ['achieved', 'partly', 'carried_over', 'not_pursued'] as const;

/** A development plan: the coachee's plan for a period, agreed with their coach. */
export const plan = pgTable(
  'plan',
  {
    id: text('id').$type<PlanId>().primaryKey(),
    tenantId: tenantIdColumn(),
    ownerId: text('owner_id').$type<PersonId>().notNull(),
    title: text('title').notNull(),
    /** Why this matters to my practice (free text; never production numbers). */
    intent: text('intent').notNull().default(''),
    periodStart: isoDate('period_start').notNull(),
    periodEnd: isoDate('period_end').notNull(),
    status: text('status').notNull(),
    agreedById: text('agreed_by_id').$type<PersonId>(),
    agreedAt: instant('agreed_at'),
    endorsedById: text('endorsed_by_id').$type<PersonId>(),
    endorsedAt: instant('endorsed_at'),
    /** Closing review written when the plan completes. */
    closingSummary: text('closing_summary'),
    version: versionColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('plan_tenant_id_key').on(t.tenantId, t.id),
    unique('plan_owner_key').on(t.tenantId, t.id, t.ownerId),
    personFk('plan_owner_fk', t.tenantId, t.ownerId),
    personFk('plan_agreed_by_fk', t.tenantId, t.agreedById),
    personFk('plan_endorsed_by_fk', t.tenantId, t.endorsedById),
    oneOf('plan_status_check', t.status, PlanLifecycle.states),
    check('plan_period', sql`${t.periodEnd} > ${t.periodStart}`),
    check('plan_agreed_pair', sql`(${t.agreedById} is null) = (${t.agreedAt} is null)`),
    check('plan_not_self_agreed', sql`${t.agreedById} is null or ${t.agreedById} <> ${t.ownerId}`),
    check(
      'plan_agreed_when_live',
      sql`${t.status} not in ('active', 'paused', 'completed') or ${t.agreedById} is not null`,
    ),
    uniqueIndex('plan_one_current_per_owner')
      .on(t.tenantId, t.ownerId)
      .where(inList(t.status, CURRENT_PLAN_STATES)),
    index('plan_period_end_idx').on(t.status, t.periodEnd),
  ],
);

/** Focus skill of a plan, with its goal: reach `target_level`. At most 3 (enforced in use case + lifecycle). */
export const planSkill = pgTable(
  'plan_skill',
  {
    tenantId: tenantIdColumn(),
    planId: text('plan_id').$type<PlanId>().notNull(),
    skillId: text('skill_id').$type<SkillId>().notNull(),
    targetLevel: integer('target_level').notNull(),
    profileKey: profileKeyColumn(),
    position: integer('position').notNull().default(0),
    /** Set in the closing review. */
    outcome: text('outcome'),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.skillId] }),
    foreignKey({
      name: 'plan_skill_plan_fk',
      columns: [t.tenantId, t.planId],
      foreignColumns: [plan.tenantId, plan.id],
    }),
    skillFk('plan_skill_skill_fk', t.tenantId, t.skillId),
    oneOf('plan_skill_target_level_check', t.targetLevel, LEVELS),
    profileKeyCheck('plan_skill_profile_key_check', t.profileKey),
    oneOfOrNull('plan_skill_outcome_check', t.outcome, PLAN_OUTCOMES),
    // At most three focus skills, by construction.
    check('plan_skill_position_check', sql`${t.position} between 0 and 2`),
    unique('plan_skill_position_key').on(t.planId, t.position),
    index('plan_skill_skill_idx').on(t.tenantId, t.skillId),
  ],
);

/**
 * Planned real work. `plan_id` is null only for ad hoc work by someone without
 * a current plan (an observer's "I saw this").
 */
export const activity = pgTable(
  'activity',
  {
    id: text('id').$type<ActivityId>().primaryKey(),
    tenantId: tenantIdColumn(),
    planId: text('plan_id').$type<PlanId>(),
    ownerId: text('owner_id').$type<PersonId>().notNull(),
    templateId: text('template_id').$type<ActivityTemplateId>(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    dueOn: isoDate('due_on'),
    origin: text('origin').notNull().default('planned'),
    /** Observation commitment made when planning (red-team: plans name their observers). */
    intendedObserverId: text('intended_observer_id').$type<PersonId>(),
    intendedMode: text('intended_mode'),
    status: text('status').notNull(),
    version: versionColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('activity_tenant_id_key').on(t.tenantId, t.id),
    unique('activity_owner_key').on(t.tenantId, t.id, t.ownerId),
    // An activity in a plan belongs to the plan's owner.
    foreignKey({
      name: 'activity_plan_owner_fk',
      columns: [t.tenantId, t.planId, t.ownerId],
      foreignColumns: [plan.tenantId, plan.id, plan.ownerId],
    }),
    foreignKey({
      name: 'activity_template_fk',
      columns: [t.tenantId, t.templateId],
      foreignColumns: [activityTemplate.tenantId, activityTemplate.id],
    }),
    personFk('activity_owner_fk', t.tenantId, t.ownerId),
    personFk('activity_intended_observer_fk', t.tenantId, t.intendedObserverId),
    oneOf('activity_status_check', t.status, ActivityLifecycle.states),
    oneOf('activity_origin_check', t.origin, ACTIVITY_ORIGINS),
    oneOfOrNull('activity_intended_mode_check', t.intendedMode, OBSERVATION_MODES),
    check('activity_plan_or_ad_hoc', sql`${t.planId} is not null or ${t.origin} = 'ad_hoc'`),
    index('activity_plan_idx').on(t.tenantId, t.planId),
    index('activity_owner_idx').on(t.tenantId, t.ownerId),
  ],
);

export const activitySkill = pgTable(
  'activity_skill',
  {
    tenantId: tenantIdColumn(),
    activityId: text('activity_id').$type<ActivityId>().notNull(),
    skillId: text('skill_id').$type<SkillId>().notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.activityId, t.skillId] }),
    foreignKey({
      name: 'activity_skill_activity_fk',
      columns: [t.tenantId, t.activityId],
      foreignColumns: [activity.tenantId, activity.id],
    }),
    skillFk('activity_skill_skill_fk', t.tenantId, t.skillId),
  ],
);

/** One dated occurrence of doing the work. Logging it never credits anything. */
export const interaction = pgTable(
  'interaction',
  {
    id: text('id').$type<InteractionId>().primaryKey(),
    tenantId: tenantIdColumn(),
    activityId: text('activity_id').$type<ActivityId>().notNull(),
    ownerId: text('owner_id').$type<PersonId>().notNull(),
    loggedById: text('logged_by_id').$type<PersonId>().notNull(),
    occurredOn: isoDate('occurred_on').notNull(),
    kind: text('kind').notNull(),
    /** Opaque CRM reference only — never a client name (ADR 0012). */
    clientRef: text('client_ref'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('interaction_tenant_id_key').on(t.tenantId, t.id),
    unique('interaction_owner_key').on(t.tenantId, t.id, t.ownerId),
    unique('interaction_date_key').on(t.tenantId, t.id, t.occurredOn),
    // The interaction belongs to the activity's owner.
    foreignKey({
      name: 'interaction_activity_owner_fk',
      columns: [t.tenantId, t.activityId, t.ownerId],
      foreignColumns: [activity.tenantId, activity.id, activity.ownerId],
    }),
    personFk('interaction_owner_fk', t.tenantId, t.ownerId),
    personFk('interaction_logged_by_fk', t.tenantId, t.loggedById),
    oneOf('interaction_kind_check', t.kind, INTERACTION_KINDS),
    check(
      'interaction_client_ref_shape',
      sql`${t.clientRef} is null or ${t.clientRef} ~ '^[A-Za-z0-9_-]{1,64}$'`,
    ),
    index('interaction_activity_idx').on(t.tenantId, t.activityId),
    index('interaction_owner_idx').on(t.tenantId, t.ownerId, t.occurredOn),
  ],
);

/** Screened text about an interaction (content; retention class `evidence`). */
export const evidence = pgTable(
  'evidence',
  {
    id: text('id').$type<EvidenceId>().primaryKey(),
    tenantId: tenantIdColumn(),
    interactionId: text('interaction_id').$type<InteractionId>().notNull(),
    authorId: text('author_id').$type<PersonId>().notNull(),
    /** Content; null once purged under its retention class. */
    body: text('body'),
    /** SHA-256 of the body; survives a purge so audit and AI records still resolve. */
    contentDigest: text('content_digest').notNull(),
    purgedAt: instant('purged_at'),
    status: text('status').notNull(),
    holdReason: text('hold_reason'),
    version: versionColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('evidence_tenant_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'evidence_interaction_fk',
      columns: [t.tenantId, t.interactionId],
      foreignColumns: [interaction.tenantId, interaction.id],
    }),
    personFk('evidence_author_fk', t.tenantId, t.authorId),
    oneOf('evidence_status_check', t.status, EvidenceLifecycle.states),
    check('evidence_purge_shape', sql`(${t.body} is null) = (${t.purgedAt} is not null)`),
    index('evidence_interaction_idx').on(t.tenantId, t.interactionId),
    index('evidence_status_idx').on(t.tenantId, t.status),
  ],
);
