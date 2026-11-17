import {
  BADGE_LEVELS,
  BadgeAwardLifecycle,
  LEVELS,
  OBSERVATION_MODES,
  OBSERVER_BASES,
  ObservationLifecycle,
  type BadgeAwardId,
  type BadgeWaiverId,
  type CreditId,
  type CreditReversalId,
  type DesignationId,
  type EngagementId,
  type InteractionId,
  type IsoDate,
  type ObservationId,
  type PersonId,
  type PositionId,
  type ReportingLineId,
  type SkillId,
  type SkillIndicatorId,
  type SkillVersionId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { skillFk, skillIndicator, skillVersion } from './catalog.ts';
import { engagement, observerDesignation } from './coaching.ts';
import {
  createdAt,
  inList,
  instant,
  isoDate,
  oneOf,
  profileKeyCheck,
  profileKeyColumn,
  tenantIdColumn,
  updatedAt,
  versionColumn,
} from './columns.ts';
import { interaction } from './development.ts';
import { personFk, personPosition, reportingLine } from './directory.ts';

const LIVE_OBSERVATION_STATES = [
  'requested',
  'drafting',
  'returned',
  'signed',
  'under_review',
] as const;
const SIGNED_STATES = ['signed', 'under_review', 'voided'] as const;

/**
 * An eligible observer's account of an interaction. Only SIGN posts credit
 * (ADR 0007). Once signed, mode, basis, parties and ratings are frozen by
 * trigger (migration `*_integrity`).
 */
export const observation = pgTable(
  'observation',
  {
    id: text('id').$type<ObservationId>().primaryKey(),
    tenantId: tenantIdColumn(),
    interactionId: text('interaction_id').$type<InteractionId>().notNull(),
    subjectId: text('subject_id').$type<PersonId>().notNull(),
    observerId: text('observer_id').$type<PersonId>().notNull(),
    requestedById: text('requested_by_id').$type<PersonId>().notNull(),
    /** Why the observer was eligible (I4), pointing at the exact edge that made them so. */
    basis: text('basis').notNull(),
    basisReportingLineId: text('basis_reporting_line_id').$type<ReportingLineId>(),
    basisEngagementId: text('basis_engagement_id').$type<EngagementId>(),
    basisDesignationId: text('basis_designation_id').$type<DesignationId>(),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    /** "What I saw" — content (retention class `narrative`); null once purged. */
    narrativeSaw: text('narrative_saw'),
    narrativeNext: text('narrative_next'),
    /** SHA-256 of the signed narrative; survives purges. */
    contentDigest: text('content_digest'),
    purgedAt: instant('purged_at'),
    dueAt: instant('due_at').notNull(),
    signedAt: instant('signed_at'),
    acknowledgedAt: instant('acknowledged_at'),
    version: versionColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('observation_tenant_id_key').on(t.tenantId, t.id),
    unique('observation_subject_key').on(t.tenantId, t.id, t.subjectId),
    unique('observation_parties_key').on(
      t.tenantId,
      t.id,
      t.subjectId,
      t.observerId,
      t.interactionId,
    ),
    // The subject is the interaction's owner.
    foreignKey({
      name: 'observation_subject_owns_interaction_fk',
      columns: [t.tenantId, t.interactionId, t.subjectId],
      foreignColumns: [interaction.tenantId, interaction.id, interaction.ownerId],
    }),
    personFk('observation_observer_fk', t.tenantId, t.observerId),
    personFk('observation_requested_by_fk', t.tenantId, t.requestedById),
    foreignKey({
      name: 'observation_basis_line_fk',
      columns: [t.tenantId, t.basisReportingLineId, t.observerId, t.subjectId],
      foreignColumns: [
        reportingLine.tenantId,
        reportingLine.id,
        reportingLine.managerId,
        reportingLine.reportId,
      ],
    }),
    foreignKey({
      name: 'observation_basis_engagement_fk',
      columns: [t.tenantId, t.basisEngagementId, t.observerId, t.subjectId],
      foreignColumns: [
        engagement.tenantId,
        engagement.id,
        engagement.coachId,
        engagement.coacheeId,
      ],
    }),
    foreignKey({
      name: 'observation_basis_designation_fk',
      columns: [t.tenantId, t.basisDesignationId, t.observerId, t.subjectId],
      foreignColumns: [
        observerDesignation.tenantId,
        observerDesignation.id,
        observerDesignation.observerId,
        observerDesignation.subjectId,
      ],
    }),
    check(
      'observation_basis_shape',
      sql`((${t.basis} = 'leader') = (${t.basisReportingLineId} is not null)) and ((${t.basis} = 'coach') = (${t.basisEngagementId} is not null)) and ((${t.basis} = 'designated') = (${t.basisDesignationId} is not null))`,
    ),
    oneOf('observation_status_check', t.status, ObservationLifecycle.states),
    oneOf('observation_basis_check', t.basis, OBSERVER_BASES),
    oneOf('observation_mode_check', t.mode, OBSERVATION_MODES),
    // Invariant I1: nobody observes themselves.
    check('observation_not_self', sql`${t.subjectId} <> ${t.observerId}`),
    check(
      'observation_signed_at',
      sql`(${inList(t.status, SIGNED_STATES)}) = (${t.signedAt} is not null)`,
    ),
    check(
      'observation_signed_digest',
      sql`${t.signedAt} is null or ${t.contentDigest} is not null`,
    ),
    index('observation_inbox_idx')
      .on(t.tenantId, t.observerId, t.dueAt)
      .where(sql`${t.status} in ('requested', 'drafting')`),
    index('observation_observer_idx').on(t.tenantId, t.observerId, t.status),
    index('observation_subject_idx').on(t.tenantId, t.subjectId, t.status),
    index('observation_interaction_idx').on(t.tenantId, t.interactionId),
    index('observation_due_idx').on(t.status, t.dueAt),
    uniqueIndex('observation_live_per_observer')
      .on(t.interactionId, t.observerId)
      .where(inList(t.status, LIVE_OBSERVATION_STATES)),
  ],
);

/**
 * One skill rated in an observation (rows exist from the request, level null).
 * `skill_version_id` pins the definition and must be a version OF that skill.
 */
export const observationRating = pgTable(
  'observation_rating',
  {
    tenantId: tenantIdColumn(),
    observationId: text('observation_id').$type<ObservationId>().notNull(),
    skillId: text('skill_id').$type<SkillId>().notNull(),
    skillVersionId: text('skill_version_id').$type<SkillVersionId>().notNull(),
    level: integer('level'),
    profileKey: profileKeyColumn(),
    /** false = feedback only ("not yet"); never posts credit. */
    credit: boolean('credit').notNull().default(true),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.observationId, t.skillId] }),
    unique('observation_rating_pinned_key').on(
      t.tenantId,
      t.observationId,
      t.skillId,
      t.skillVersionId,
    ),
    foreignKey({
      name: 'observation_rating_observation_fk',
      columns: [t.tenantId, t.observationId],
      foreignColumns: [observation.tenantId, observation.id],
    }),
    foreignKey({
      name: 'observation_rating_version_fk',
      columns: [t.tenantId, t.skillId, t.skillVersionId],
      foreignColumns: [skillVersion.tenantId, skillVersion.skillId, skillVersion.id],
    }),
    check('observation_rating_level', sql`${t.level} is null or ${t.level} between 1 and 4`),
    profileKeyCheck('observation_rating_profile_key_check', t.profileKey),
    check('observation_rating_position', sql`${t.position} between 0 and 2`),
    unique('observation_rating_position_key').on(t.observationId, t.position),
    index('observation_rating_skill_idx').on(t.tenantId, t.skillId),
  ],
);

/** An indicator the observer ticked — always from the version the rating pinned. */
export const observationIndicator = pgTable(
  'observation_indicator',
  {
    tenantId: tenantIdColumn(),
    observationId: text('observation_id').$type<ObservationId>().notNull(),
    skillId: text('skill_id').$type<SkillId>().notNull(),
    skillVersionId: text('skill_version_id').$type<SkillVersionId>().notNull(),
    indicatorId: text('indicator_id').$type<SkillIndicatorId>().notNull(),
    /** true when the observer accepted an assistant suggestion (label provenance). */
    suggested: boolean('suggested').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.observationId, t.indicatorId] }),
    foreignKey({
      name: 'observation_indicator_rating_fk',
      columns: [t.tenantId, t.observationId, t.skillId, t.skillVersionId],
      foreignColumns: [
        observationRating.tenantId,
        observationRating.observationId,
        observationRating.skillId,
        observationRating.skillVersionId,
      ],
    }),
    foreignKey({
      name: 'observation_indicator_indicator_fk',
      columns: [t.tenantId, t.skillVersionId, t.indicatorId],
      foreignColumns: [skillIndicator.tenantId, skillIndicator.skillVersionId, skillIndicator.id],
    }),
    index('observation_indicator_indicator_idx').on(t.tenantId, t.indicatorId),
  ],
);

/**
 * Append-only ledger of demonstrations (ADR 0007), enforced by trigger. One row
 * per (observation, skill): a second observer of the same interaction writes
 * their own row, so disagreement stays visible. Every column is pinned to its
 * observation, rating and interaction by composite FKs, so a credit cannot
 * disagree with the observation that created it.
 */
export const creditEntry = pgTable(
  'credit_entry',
  {
    id: text('id').$type<CreditId>().primaryKey(),
    tenantId: tenantIdColumn(),
    personId: text('person_id').$type<PersonId>().notNull(),
    skillId: text('skill_id').$type<SkillId>().notNull(),
    observationId: text('observation_id').$type<ObservationId>().notNull(),
    interactionId: text('interaction_id').$type<InteractionId>().notNull(),
    observerId: text('observer_id').$type<PersonId>().notNull(),
    skillVersionId: text('skill_version_id').$type<SkillVersionId>().notNull(),
    level: integer('level').notNull(),
    profileKey: profileKeyColumn(),
    /** The subject's position on the interaction date, when the directory knows it (ADR 0017). */
    subjectPositionId: text('subject_position_id').$type<PositionId>(),
    mode: text('mode').notNull(),
    isFirstHand: boolean('is_first_hand').notNull(),
    /** The interaction date: when the skill was shown (span criterion). */
    demonstratedOn: isoDate('demonstrated_on').notNull(),
    policyVersion: text('policy_version').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('credit_entry_tenant_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'credit_entry_observation_fk',
      columns: [t.tenantId, t.observationId, t.personId, t.observerId, t.interactionId],
      foreignColumns: [
        observation.tenantId,
        observation.id,
        observation.subjectId,
        observation.observerId,
        observation.interactionId,
      ],
    }),
    foreignKey({
      name: 'credit_entry_rating_fk',
      columns: [t.tenantId, t.observationId, t.skillId, t.skillVersionId],
      foreignColumns: [
        observationRating.tenantId,
        observationRating.observationId,
        observationRating.skillId,
        observationRating.skillVersionId,
      ],
    }),
    foreignKey({
      name: 'credit_entry_interaction_fk',
      columns: [t.tenantId, t.interactionId, t.demonstratedOn],
      foreignColumns: [interaction.tenantId, interaction.id, interaction.occurredOn],
    }),
    foreignKey({
      name: 'credit_entry_position_fk',
      columns: [t.tenantId, t.subjectPositionId, t.personId],
      foreignColumns: [personPosition.tenantId, personPosition.id, personPosition.personId],
    }),
    profileKeyCheck('credit_entry_profile_key_check', t.profileKey),
    oneOf('credit_entry_level_check', t.level, LEVELS),
    oneOf('credit_entry_mode_check', t.mode, OBSERVATION_MODES),
    check('credit_entry_first_hand', sql`${t.isFirstHand} = (${t.mode} <> 'discussed')`),
    check('credit_entry_not_self', sql`${t.personId} <> ${t.observerId}`),
    unique('credit_entry_one_per_observation_skill').on(t.observationId, t.skillId),
    index('credit_entry_person_skill_idx').on(t.tenantId, t.personId, t.skillId),
    index('credit_entry_observer_idx').on(t.tenantId, t.observerId, t.createdAt),
  ],
);

/** Cancels exactly one credit (VOID). Reversing a reversal is impossible by construction. */
export const creditReversal = pgTable(
  'credit_reversal',
  {
    id: text('id').$type<CreditReversalId>().primaryKey(),
    tenantId: tenantIdColumn(),
    creditEntryId: text('credit_entry_id').$type<CreditId>().notNull(),
    reversedById: text('reversed_by_id').$type<PersonId>().notNull(),
    reasonCode: text('reason_code').notNull(),
    policyVersion: text('policy_version').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'credit_reversal_credit_fk',
      columns: [t.tenantId, t.creditEntryId],
      foreignColumns: [creditEntry.tenantId, creditEntry.id],
    }),
    unique('credit_reversal_one_per_credit').on(t.creditEntryId),
    personFk('credit_reversal_actor_fk', t.tenantId, t.reversedById),
  ],
);

export interface BadgeCriteriaSnapshot {
  readonly thresholds: Readonly<Record<string, number>>;
  readonly measured: Readonly<Record<string, number>>;
  readonly firstDemonstratedOn: IsoDate;
  readonly lastDemonstratedOn: IsoDate;
}

export const badgeAward = pgTable(
  'badge_award',
  {
    id: text('id').$type<BadgeAwardId>().primaryKey(),
    tenantId: tenantIdColumn(),
    personId: text('person_id').$type<PersonId>().notNull(),
    skillId: text('skill_id').$type<SkillId>().notNull(),
    level: integer('level').notNull(),
    profileKey: profileKeyColumn(),
    status: text('status').notNull(),
    /** Thresholds in force and measured values at award time. */
    criteria: jsonb('criteria').$type<BadgeCriteriaSnapshot>().notNull(),
    policyVersion: text('policy_version').notNull(),
    triggeringObservationId: text('triggering_observation_id').$type<ObservationId>().notNull(),
    awardedAt: instant('awarded_at').notNull(),
    revokedAt: instant('revoked_at'),
    revokedByReversalId: text('revoked_by_reversal_id').$type<CreditReversalId>(),
  },
  (t) => [
    unique('badge_award_tenant_id_key').on(t.tenantId, t.id),
    personFk('badge_award_person_fk', t.tenantId, t.personId),
    skillFk('badge_award_skill_fk', t.tenantId, t.skillId),
    foreignKey({
      name: 'badge_award_trigger_fk',
      columns: [t.tenantId, t.triggeringObservationId],
      foreignColumns: [observation.tenantId, observation.id],
    }),
    oneOf('badge_award_status_check', t.status, BadgeAwardLifecycle.states),
    oneOf('badge_award_level_check', t.level, BADGE_LEVELS),
    check(
      'badge_award_revoked_shape',
      sql`(${t.status} = 'revoked') = (${t.revokedAt} is not null)`,
    ),
    profileKeyCheck('badge_award_profile_key_check', t.profileKey),
    uniqueIndex('badge_award_one_active')
      .on(t.tenantId, t.personId, t.skillId, t.profileKey, t.level)
      .where(sql`${t.status} = 'awarded'`),
    index('badge_award_skill_idx').on(t.tenantId, t.skillId, t.status),
  ],
);

/** The receipt: exactly which demonstrations earned the badge. Append-only. */
export const badgeAwardCredit = pgTable(
  'badge_award_credit',
  {
    tenantId: tenantIdColumn(),
    badgeAwardId: text('badge_award_id').$type<BadgeAwardId>().notNull(),
    creditEntryId: text('credit_entry_id').$type<CreditId>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.badgeAwardId, t.creditEntryId] }),
    foreignKey({
      name: 'badge_award_credit_award_fk',
      columns: [t.tenantId, t.badgeAwardId],
      foreignColumns: [badgeAward.tenantId, badgeAward.id],
    }),
    foreignKey({
      name: 'badge_award_credit_credit_fk',
      columns: [t.tenantId, t.creditEntryId],
      foreignColumns: [creditEntry.tenantId, creditEntry.id],
    }),
  ],
);

/** An audited exception to one badge criterion (e.g. only one eligible observer). */
export const badgeWaiver = pgTable(
  'badge_waiver',
  {
    id: text('id').$type<BadgeWaiverId>().primaryKey(),
    tenantId: tenantIdColumn(),
    personId: text('person_id').$type<PersonId>().notNull(),
    criterion: text('criterion').notNull(),
    grantedById: text('granted_by_id').$type<PersonId>().notNull(),
    reasonCode: text('reason_code').notNull(),
    validFrom: isoDate('valid_from').notNull(),
    validTo: isoDate('valid_to'),
    createdAt: createdAt(),
  },
  (t) => [
    personFk('badge_waiver_person_fk', t.tenantId, t.personId),
    personFk('badge_waiver_granted_by_fk', t.tenantId, t.grantedById),
    oneOf('badge_waiver_criterion_check', t.criterion, ['observers', 'firstHand']),
    check('badge_waiver_not_self', sql`${t.personId} <> ${t.grantedById}`),
  ],
);
