import {
  ADVISORY_DISPOSITIONS,
  AdvisoryCheckLifecycle,
  QUESTION_SETS,
  type AdvisoryCheckId,
  type AdvisoryDispositionId,
  type PersonId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, oneOf, tenantIdColumn } from './columns.ts';
import { personFk, tenant } from './directory.ts';

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
    createdAt: createdAt(),
    completedAt: instant('completed_at'),
  },
  (t) => [
    unique('advisory_check_tenant_id_key').on(t.tenantId, t.id),
    oneOf('advisory_check_subject_type_check', t.subjectType, [
      'evidence',
      'observation',
      'interaction',
    ]),
    oneOf('advisory_check_status_check', t.status, AdvisoryCheckLifecycle.states),
    oneOf('advisory_check_question_set_check', t.questionSet, QUESTION_SETS),
    oneOf('advisory_check_provider_check', t.provider, ['google', 'mock', 'disabled', 'local']),
    check(
      'advisory_check_effect_check',
      sql`${t.effect} is null or ${t.effect} in ('hold', 'escalate', 'nudge', 'none')`,
    ),
    index('advisory_check_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
    index('advisory_check_usage_idx').on(t.tenantId, t.createdAt),
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
