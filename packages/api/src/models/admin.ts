import { IsoDate, QuestionSetId } from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary } from './common.ts';

/** Assistant checks and the holds they caused, per day and question set (ADR 0015). */
export const AiUsageRow = Schema.Struct({
  day: IsoDate,
  questionSet: QuestionSetId,
  provider: Schema.String,
  checks: Schema.Number,
  failed: Schema.Number,
  /** Held or escalated. */
  holds: Schema.Number,
});
export type AiUsageRow = typeof AiUsageRow.Type;

export const AiUsageView = Schema.Struct({
  from: IsoDate,
  to: IsoDate,
  totalChecks: Schema.Number,
  totalHolds: Schema.Number,
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
