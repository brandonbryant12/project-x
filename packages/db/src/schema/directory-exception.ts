import {
  DIRECTORY_EXCEPTION_KINDS,
  DirectoryExceptionLifecycle,
  type DirectoryExceptionId,
  type DirectoryExceptionKind,
  type IsoDate,
  type PersonId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, inList, instant, isoDate, oneOf, tenantIdColumn } from './columns.ts';
import { personFk, tenant } from './directory.ts';

/**
 * The directory exceptions queue (ADR 0006). HR data that breaks a structural
 * rule ("a coach reports to a coach") or cannot be applied is recorded here
 * for a tenant admin, never rejected. There is no free-text column: the
 * explanation is rendered from `kind` and the structured `data` (emails,
 * row numbers), so nothing user-written lands here.
 */
export const directoryException = pgTable(
  'directory_exception',
  {
    id: text('id').$type<DirectoryExceptionId>().primaryKey(),
    tenantId: tenantIdColumn().references(() => tenant.id),
    kind: text('kind').$type<DirectoryExceptionKind>().notNull(),
    /** The person the exception is about, when they exist in the directory. */
    personId: text('person_id').$type<PersonId>(),
    /** The address in the HR file (lower case); null for a row without one. */
    email: text('email'),
    /** One live exception per (kind, subject): re-running an import does not duplicate it. */
    dedupeKey: text('dedupe_key').notNull(),
    data: jsonb('data').$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    status: text('status').notNull().default('open'),
    detectedOn: isoDate('detected_on').$type<IsoDate>().notNull(),
    acknowledgedById: text('acknowledged_by_id').$type<PersonId>(),
    acknowledgedAt: instant('acknowledged_at'),
    resolvedAt: instant('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    personFk('directory_exception_person_fk', t.tenantId, t.personId),
    personFk('directory_exception_acknowledged_by_fk', t.tenantId, t.acknowledgedById),
    oneOf('directory_exception_kind_check', t.kind, DIRECTORY_EXCEPTION_KINDS),
    oneOf('directory_exception_status_check', t.status, DirectoryExceptionLifecycle.states),
    check(
      'directory_exception_acknowledged_shape',
      sql`(${t.acknowledgedById} is null) = (${t.acknowledgedAt} is null)`,
    ),
    check(
      'directory_exception_resolved_shape',
      sql`(${t.status} = 'resolved') = (${t.resolvedAt} is not null)`,
    ),
    uniqueIndex('directory_exception_live_unique')
      .on(t.tenantId, t.dedupeKey)
      .where(inList(t.status, ['open', 'acknowledged'])),
    index('directory_exception_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
  ],
);
