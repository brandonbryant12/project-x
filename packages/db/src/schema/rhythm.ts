import {
  CONVERSATION_BASES,
  CommitmentLifecycle,
  ConversationLifecycle,
  MAX_COMMITMENT_LENGTH,
  type CommitmentId,
  type ConversationId,
  type EngagementId,
  type ObservationId,
  type PersonId,
  type ReportingLineId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { engagement } from './coaching.ts';
import {
  createdAt,
  instant,
  isoDate,
  oneOf,
  tenantIdColumn,
  updatedAt,
  versionColumn,
} from './columns.ts';
import { personFk, reportingLine } from './directory.ts';
import { observation } from './recognition.ts';

/**
 * The weekly rhythm (ADR 0019). A conversation between a coachee and their
 * engaged coach or their leader. Like an observation, its basis points at the
 * exact relationship edge, so a leader's 1:1 and a coaching session are one
 * object. The agenda is assembled from facts and never stored.
 */
export const coachingConversation = pgTable(
  'coaching_conversation',
  {
    id: text('id').$type<ConversationId>().primaryKey(),
    tenantId: tenantIdColumn(),
    coacheeId: text('coachee_id').$type<PersonId>().notNull(),
    hostId: text('host_id').$type<PersonId>().notNull(),
    basis: text('basis').notNull(),
    basisEngagementId: text('basis_engagement_id').$type<EngagementId>(),
    basisReportingLineId: text('basis_reporting_line_id').$type<ReportingLineId>(),
    createdById: text('created_by_id').$type<PersonId>().notNull(),
    status: text('status').notNull(),
    scheduledFor: instant('scheduled_for').notNull(),
    heldOn: isoDate('held_on'),
    closedAt: instant('closed_at'),
    version: versionColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('coaching_conversation_coachee_key').on(t.tenantId, t.id, t.coacheeId),
    personFk('coaching_conversation_coachee_fk', t.tenantId, t.coacheeId),
    personFk('coaching_conversation_host_fk', t.tenantId, t.hostId),
    personFk('coaching_conversation_created_by_fk', t.tenantId, t.createdById),
    foreignKey({
      name: 'coaching_conversation_engagement_fk',
      columns: [t.tenantId, t.basisEngagementId, t.hostId, t.coacheeId],
      foreignColumns: [
        engagement.tenantId,
        engagement.id,
        engagement.coachId,
        engagement.coacheeId,
      ],
    }),
    foreignKey({
      name: 'coaching_conversation_line_fk',
      columns: [t.tenantId, t.basisReportingLineId, t.hostId, t.coacheeId],
      foreignColumns: [
        reportingLine.tenantId,
        reportingLine.id,
        reportingLine.managerId,
        reportingLine.reportId,
      ],
    }),
    oneOf('coaching_conversation_basis_check', t.basis, CONVERSATION_BASES),
    check(
      'coaching_conversation_basis_shape',
      sql`((${t.basis} = 'coach') = (${t.basisEngagementId} is not null)) and ((${t.basis} = 'leader') = (${t.basisReportingLineId} is not null))`,
    ),
    oneOf('coaching_conversation_status_check', t.status, ConversationLifecycle.states),
    check('coaching_conversation_not_self', sql`${t.hostId} <> ${t.coacheeId}`),
    check(
      'coaching_conversation_creator_is_party',
      sql`${t.createdById} in (${t.hostId}, ${t.coacheeId})`,
    ),
    check(
      'coaching_conversation_held_shape',
      sql`(${t.status} = 'held') = (${t.heldOn} is not null)`,
    ),
    check(
      'coaching_conversation_closed_shape',
      sql`(${t.status} = 'scheduled') = (${t.closedAt} is null)`,
    ),
    index('coaching_conversation_host_idx').on(t.tenantId, t.hostId, t.scheduledFor),
    index('coaching_conversation_coachee_idx').on(t.tenantId, t.coacheeId, t.scheduledFor),
  ],
);

/**
 * Something the coachee agreed to do next (ADR 0019). From an observer's "next
 * step" or from a conversation. Never earns credit. `body` is purgeable content
 * (retention class `narrative`) and passes the local privacy screen.
 */
export const commitment = pgTable(
  'commitment',
  {
    id: text('id').$type<CommitmentId>().primaryKey(),
    tenantId: tenantIdColumn(),
    ownerId: text('owner_id').$type<PersonId>().notNull(),
    createdById: text('created_by_id').$type<PersonId>().notNull(),
    body: text('body'),
    purgedAt: instant('purged_at'),
    sourceObservationId: text('source_observation_id').$type<ObservationId>(),
    conversationId: text('conversation_id').$type<ConversationId>(),
    dueOn: isoDate('due_on'),
    status: text('status').notNull(),
    closedAt: instant('closed_at'),
    version: versionColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    personFk('commitment_owner_fk', t.tenantId, t.ownerId),
    personFk('commitment_created_by_fk', t.tenantId, t.createdById),
    // A commitment from an observation belongs to that observation's subject.
    foreignKey({
      name: 'commitment_observation_fk',
      columns: [t.tenantId, t.sourceObservationId, t.ownerId],
      foreignColumns: [observation.tenantId, observation.id, observation.subjectId],
    }),
    foreignKey({
      name: 'commitment_conversation_fk',
      columns: [t.tenantId, t.conversationId, t.ownerId],
      foreignColumns: [
        coachingConversation.tenantId,
        coachingConversation.id,
        coachingConversation.coacheeId,
      ],
    }),
    oneOf('commitment_status_check', t.status, CommitmentLifecycle.states),
    check(
      'commitment_body_length',
      sql`${t.body} is null or char_length(${t.body}) between 1 and ${sql.raw(String(MAX_COMMITMENT_LENGTH))}`,
    ),
    check('commitment_purge_shape', sql`(${t.purgedAt} is null) = (${t.body} is not null)`),
    check('commitment_closed_shape', sql`(${t.status} = 'open') = (${t.closedAt} is null)`),
    index('commitment_owner_idx').on(t.tenantId, t.ownerId, t.status),
  ],
);
