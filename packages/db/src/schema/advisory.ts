import {
  ADVISORY_DISPOSITIONS,
  AdvisoryCheckLifecycle,
  LABEL_SOURCES,
  QUESTION_SETS,
  type AdvisoryCheckId,
  type AdvisoryDispositionId,
  type AdvisoryLabelId,
  type ObservationId,
  type PersonId,
  type QuestionSetReleaseId,
  type SecondReadId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, oneOf, tenantIdColumn } from './columns.ts';
import { personFk, tenant } from './directory.ts';
import { observation } from './recognition.ts';

export interface AdvisoryAnswersRecord {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly missing: ReadonlyArray<string>;
  readonly malformed: ReadonlyArray<string>;
  readonly inputTokens: number;
}

/**
 * One AI evaluation and its explainable decision record (ADR 0015). The input
 * text is never stored here — only its digest and a pointer to its source.
 */
export const advisoryCheck = pgTable(
  'advisory_check',
  {
    id: text('id').$type<AdvisoryCheckId>().primaryKey(),
    tenantId: tenantIdColumn().references(() => tenant.id),
    questionSet: text('question_set').notNull(),
    questionSetVersion: integer('question_set_version').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** The subject row's `version` when evaluated: a stale check can never apply to newer text. */
    subjectVersion: integer('subject_version').notNull(),
    /** `shown` to people, or `shadow` (computed, never shown) for unbiased labels (ADR 0016). */
    arm: text('arm').notNull().default('shown'),
    status: text('status').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    inputDigest: text('input_digest').notNull(),
    questionsDigest: text('questions_digest').notNull(),
    answers: jsonb('answers').$type<AdvisoryAnswersRecord>(),
    thresholds: jsonb('thresholds').$type<Readonly<Record<string, number>>>().notNull().default({}),
    result: jsonb('result'),
    effect: text('effect').$type<'hold' | 'escalate' | 'nudge' | 'none'>(),
    rationale: text('rationale'),
    failure: text('failure'),
    inputTokens: integer('input_tokens'),
    costUsdMicros: integer('cost_usd_micros'),
    latencyMs: integer('latency_ms'),
    /** LangSmith root run id when tracing is on (ADR 0016). */
    traceRunId: text('trace_run_id'),
    createdAt: createdAt(),
    completedAt: instant('completed_at'),
  },
  (t) => [
    unique('advisory_check_tenant_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'advisory_check_release_fk',
      columns: [t.questionSet, t.questionSetVersion],
      foreignColumns: [questionSetRelease.questionSet, questionSetRelease.setVersion],
    }),
    foreignKey({
      name: 'advisory_check_questions_fk',
      columns: [t.questionsDigest],
      foreignColumns: [advisoryQuestionSnapshot.digest],
    }),
    oneOf('advisory_check_subject_type_check', t.subjectType, [
      'evidence',
      'observation',
      'interaction',
    ]),
    oneOf('advisory_check_status_check', t.status, AdvisoryCheckLifecycle.states),
    oneOf('advisory_check_question_set_check', t.questionSet, QUESTION_SETS),
    oneOf('advisory_check_arm_check', t.arm, ['shown', 'shadow']),
    oneOf('advisory_check_provider_check', t.provider, ['google', 'mock', 'disabled', 'local']),
    check(
      'advisory_check_effect_check',
      sql`${t.effect} is null or ${t.effect} in ('hold', 'escalate', 'nudge', 'none')`,
    ),
    index('advisory_check_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
    index('advisory_check_usage_idx').on(t.tenantId, t.createdAt),
  ],
);

/** Who saw a check, and whether they opened it. Lets evaluation exclude anchored labels. */
export const advisoryExposure = pgTable(
  'advisory_exposure',
  {
    tenantId: tenantIdColumn(),
    checkId: text('check_id').$type<AdvisoryCheckId>().notNull(),
    viewerId: text('viewer_id').$type<PersonId>().notNull(),
    firstSeenAt: instant('first_seen_at').notNull(),
    expanded: boolean('expanded').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.checkId, t.viewerId] }),
    foreignKey({
      name: 'advisory_exposure_check_fk',
      columns: [t.tenantId, t.checkId],
      foreignColumns: [advisoryCheck.tenantId, advisoryCheck.id],
    }),
    personFk('advisory_exposure_viewer_fk', t.tenantId, t.viewerId),
  ],
);

/**
 * Ground truth for ONE question of ONE check, derived server-side from a real
 * action (ADR 0016) — never a "was this helpful?" click. Append-only.
 */
export const advisoryLabel = pgTable(
  'advisory_label',
  {
    id: text('id').$type<AdvisoryLabelId>().primaryKey(),
    tenantId: tenantIdColumn(),
    checkId: text('check_id').$type<AdvisoryCheckId>().notNull(),
    questionKey: text('question_key').notNull(),
    questionSet: text('question_set').notNull(),
    questionSetVersion: integer('question_set_version').notNull(),
    modelProbability: doublePrecision('model_probability'),
    threshold: doublePrecision('threshold'),
    /** The human truth in the question's closed set, e.g. 'yes' | 'no' or a choice key. */
    labelValue: text('label_value').notNull(),
    source: text('source').notNull(),
    strength: text('strength').notNull(),
    /** The check's arm at labeling time; only `shadow` + gold labels enter eval sets. */
    arm: text('arm').notNull(),
    labelerId: text('labeler_id').$type<PersonId>(),
    labelerRole: text('labeler_role'),
    inputEntityType: text('input_entity_type').notNull(),
    inputEntityId: text('input_entity_id').notNull(),
    inputDigest: text('input_digest').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'advisory_label_check_fk',
      columns: [t.tenantId, t.checkId],
      foreignColumns: [advisoryCheck.tenantId, advisoryCheck.id],
    }),
    personFk('advisory_label_labeler_fk', t.tenantId, t.labelerId),
    oneOf('advisory_label_source_check', t.source, LABEL_SOURCES),
    oneOf('advisory_label_strength_check', t.strength, ['gold', 'silver', 'weak']),
    oneOf('advisory_label_arm_check', t.arm, ['shown', 'shadow']),
    oneOf('advisory_label_question_set_check', t.questionSet, QUESTION_SETS),
    // Retries must not double-count a label in an evaluation set.
    unique('advisory_label_once').on(t.tenantId, t.checkId, t.questionKey, t.source),
    index('advisory_label_set_idx').on(t.questionSet, t.questionSetVersion, t.createdAt),
  ],
);

/** A blind calibration read of a signed observation: neither the level nor the AI output is shown. */
export const secondRead = pgTable(
  'second_read',
  {
    id: text('id').$type<SecondReadId>().primaryKey(),
    tenantId: tenantIdColumn(),
    observationId: text('observation_id').$type<ObservationId>().notNull(),
    readerId: text('reader_id').$type<PersonId>().notNull(),
    assignedReason: text('assigned_reason').notNull(),
    narrativeSpecific: boolean('narrative_specific'),
    status: text('status').notNull().default('assigned'),
    createdAt: createdAt(),
    completedAt: instant('completed_at'),
  },
  (t) => [
    foreignKey({
      name: 'second_read_observation_fk',
      columns: [t.tenantId, t.observationId],
      foreignColumns: [observation.tenantId, observation.id],
    }),
    personFk('second_read_reader_fk', t.tenantId, t.readerId),
    oneOf('second_read_reason_check', t.assignedReason, [
      'random',
      'model_disagreement',
      'new_observer',
    ]),
    oneOf('second_read_status_check', t.status, ['assigned', 'completed', 'skipped']),
    unique('second_read_tenant_id_key').on(t.tenantId, t.id),
    index('second_read_reader_idx').on(t.tenantId, t.readerId, t.status),
  ],
);

/** The blind reader's level per skill — joinable against observation_rating for inter-rater agreement. */
export const secondReadRating = pgTable(
  'second_read_rating',
  {
    tenantId: tenantIdColumn(),
    secondReadId: text('second_read_id').$type<SecondReadId>().notNull(),
    skillId: text('skill_id').notNull(),
    level: integer('level').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.secondReadId, t.skillId] }),
    foreignKey({
      name: 'second_read_rating_read_fk',
      columns: [t.tenantId, t.secondReadId],
      foreignColumns: [secondRead.tenantId, secondRead.id],
    }),
    check('second_read_rating_level', sql`${t.level} between 1 and 4`),
  ],
);

/**
 * A human decision on an assistant check (agreed / overrode / ignored), with
 * who, why and when. Append-only. This is what an AI board asks for.
 */
export const advisoryDisposition = pgTable(
  'advisory_disposition',
  {
    id: text('id').$type<AdvisoryDispositionId>().primaryKey(),
    tenantId: tenantIdColumn(),
    checkId: text('check_id').$type<AdvisoryCheckId>().notNull(),
    actorId: text('actor_id').$type<PersonId>().notNull(),
    disposition: text('disposition').notNull(),
    reasonCode: text('reason_code').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'advisory_disposition_check_fk',
      columns: [t.tenantId, t.checkId],
      foreignColumns: [advisoryCheck.tenantId, advisoryCheck.id],
    }),
    personFk('advisory_disposition_actor_fk', t.tenantId, t.actorId),
    oneOf('advisory_disposition_value_check', t.disposition, ADVISORY_DISPOSITIONS),
    index('advisory_disposition_check_idx').on(t.tenantId, t.checkId),
  ],
);

/** Content-addressed copy of the exact questions sent, so any check can be reproduced years later. */
export const advisoryQuestionSnapshot = pgTable('advisory_question_snapshot', {
  digest: text('digest').primaryKey(),
  questions: jsonb('questions').notNull(),
  createdAt: createdAt(),
});

/** A released question-set version with the evidence that justified it (AI board record). */
export const questionSetRelease = pgTable(
  'question_set_release',
  {
    id: text('id').$type<QuestionSetReleaseId>().primaryKey(),
    questionSet: text('question_set').notNull(),
    /** Content version of the question set (not an optimistic-concurrency counter). */
    setVersion: integer('set_version').notNull(),
    /** Digest of the question template (sets built from the catalog vary per input). */
    templateDigest: text('template_digest').notNull(),
    thresholds: jsonb('thresholds').$type<Readonly<Record<string, number>>>().notNull(),
    effect: text('effect').notNull(),
    datasetRef: text('dataset_ref'),
    experimentRef: text('experiment_ref'),
    metrics: jsonb('metrics').$type<Readonly<Record<string, number>>>(),
    approvedBy: text('approved_by'),
    approvedAt: instant('approved_at'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf('question_set_release_set_check', t.questionSet, QUESTION_SETS),
    oneOf('question_set_release_effect_check', t.effect, ['hold', 'escalate', 'nudge']),
    unique('question_set_release_version_key').on(t.questionSet, t.setVersion),
  ],
);
