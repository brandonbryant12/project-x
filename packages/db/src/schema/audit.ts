import type { AuditEventId, NoteId, PersonId } from '@repo/domain';
import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, tenantIdColumn } from './columns.ts';
import { personFk, tenant } from './directory.ts';

export const AUDIT_REASON_CODES = [
  'note',
  'privacy_local',
  'privacy_assistant',
  'assistant_unavailable',
  'expired',
  'directory_change',
  'admin_release',
  'compliance_resolution',
  'data_correction',
] as const;

/**
 * Append-only record of who did what, when, why and under which rules
 * (ADR 0012, 0015), enforced by trigger. Free-text reasons are content and
 * live in `note` (purgeable); the audit row keeps a reason code and a pointer.
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: text('id').$type<AuditEventId>().primaryKey(),
    /** Total order for export; IDs are random and timestamps can tie. */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    tenantId: tenantIdColumn().references(() => tenant.id),
    /** Null for system actions (sweeps, assistant checks). */
    actorId: text('actor_id').$type<PersonId>(),
    authMethod: text('auth_method'),
    requestId: text('request_id'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    event: text('event').notNull(),
    fromState: text('from_state'),
    toState: text('to_state'),
    reasonCode: text('reason_code'),
    noteId: text('note_id').$type<NoteId>(),
    policyVersion: text('policy_version'),
    data: jsonb('data').$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    personFk('audit_event_actor_fk', t.tenantId, t.actorId),
    check(
      'audit_event_reason_code_check',
      sql`${t.reasonCode} is null or ${t.reasonCode} in (${sql.raw(AUDIT_REASON_CODES.map((c) => `'${c}'`).join(', '))})`,
    ),
    uniqueIndex('audit_event_seq_unique').on(t.seq),
    index('audit_event_tenant_seq_idx').on(t.tenantId, t.seq),
    index('audit_event_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    index('audit_event_actor_idx').on(t.tenantId, t.actorId, t.createdAt),
  ],
);
