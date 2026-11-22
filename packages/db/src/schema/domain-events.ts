import type { DomainEventId } from '@repo/domain';
import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, tenantIdColumn } from './columns.ts';
import { tenant } from './directory.ts';

/**
 * Append-only `@alchemy.run/domain` fact journal (ADR 0023).
 *
 * Stores immutable business facts emitted by domain aggregates (`ObservationSigned`,
 * `DemonstrationRecorded`, `BadgeAwarded`, `TenantPolicyUpdated`, `SkillPublished`, etc.)
 * with ZERO narrative PII (ADR 0015). Enables deterministic projection replay and
 * zero-migration rule evolution when badge/scoring criteria change.
 */
export const domainEvent = pgTable(
  'domain_event',
  {
    id: text('id').$type<DomainEventId>().primaryKey(),
    /** Total causal order across the journal for deterministic replay. */
    globalSeq: bigint('global_seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    tenantId: tenantIdColumn().references(() => tenant.id),
    /** Stream name, e.g. `Observation/obs_...` or `SkillLedger/ten_...:per_...:skl_...`. */
    stream: text('stream').notNull(),
    /** Sequence number within the aggregate stream, starting at 1. */
    streamSeq: integer('stream_seq').notNull(),
    aggregate: text('aggregate').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventTag: text('event_tag').notNull(),
    payload: jsonb('payload').$type<Readonly<Record<string, unknown>>>().notNull(),
    commandId: text('command_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    occurredAt: createdAt(),
  },
  (t) => [
    uniqueIndex('domain_event_global_seq_unique').on(t.globalSeq),
    uniqueIndex('domain_event_stream_seq_unique').on(t.tenantId, t.stream, t.streamSeq),
    index('domain_event_tenant_aggregate_idx').on(t.tenantId, t.aggregate, t.aggregateId),
    index('domain_event_tenant_tag_idx').on(t.tenantId, t.eventTag, t.occurredAt),
  ],
);
