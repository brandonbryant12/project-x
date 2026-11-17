import { IsoDate, QuestionSetId } from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary } from './common.ts';

/** AI cost and quality monitoring, per day and question set (ADR 0016). */
export const AiUsageRow = Schema.Struct({
  day: IsoDate,
  questionSet: QuestionSetId,
  provider: Schema.String,
  checks: Schema.Number,
  failed: Schema.Number,
  holds: Schema.Number,
  inputTokens: Schema.Number,
  costUsd: Schema.Number,
  p95LatencyMs: Schema.NullOr(Schema.Number),
  labels: Schema.Number,
  /** Share of gold labels that disagreed with the model's side of the threshold. */
  overrideRate: Schema.NullOr(Schema.Number),
});
export type AiUsageRow = typeof AiUsageRow.Type;

export const AiUsageView = Schema.Struct({
  from: IsoDate,
  to: IsoDate,
  totalCostUsd: Schema.Number,
  totalChecks: Schema.Number,
  rows: Schema.Array(AiUsageRow),
});
export type AiUsageView = typeof AiUsageView.Type;

export const AuditEventView = Schema.Struct({
  id: Schema.String,
  at: Instant,
  actor: Schema.NullOr(PersonSummary),
  entityType: Schema.String,
  entityId: Schema.String,
  event: Schema.String,
  fromState: Schema.NullOr(Schema.String),
  toState: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  policyVersion: Schema.NullOr(Schema.String),
});
export type AuditEventView = typeof AuditEventView.Type;
