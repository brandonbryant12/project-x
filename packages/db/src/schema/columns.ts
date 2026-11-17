import type { IsoDate, TenantId } from '@repo/domain';
import { sql, type SQL } from 'drizzle-orm';
import { check, date, integer, text, timestamp, type PgColumn } from 'drizzle-orm/pg-core';

/** Shared column builders and constraints. See docs/architecture/data-model.md. */

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
/** A business date (`*_on`). */
export const isoDate = (name: string) => date(name, { mode: 'string' }).$type<IsoDate>();
export const tenantIdColumn = () => text('tenant_id').$type<TenantId>().notNull();
/** Optimistic concurrency for workflow entities. */
export const versionColumn = () => integer('version').notNull().default(1);

const literalList = (values: ReadonlyArray<string | number>): SQL =>
  sql.raw(
    values
      .map((v) => (typeof v === 'number' ? String(v) : `'${v.replaceAll("'", "''")}'`))
      .join(', '),
  );

/** CHECK (column IN (...)) — generated from a lifecycle's states or a vocabulary. */
export const oneOf = (name: string, column: PgColumn, values: ReadonlyArray<string | number>) =>
  check(name, sql`${column} in (${literalList(values)})`);

/** As `oneOf`, allowing NULL. */
export const oneOfOrNull = (
  name: string,
  column: PgColumn,
  values: ReadonlyArray<string | number>,
) => check(name, sql`${column} is null or ${column} in (${literalList(values)})`);

/** A SQL list literal for partial-index predicates, from the same constants. */
export const inList = (column: PgColumn, values: ReadonlyArray<string | number>) =>
  sql`${column} in (${literalList(values)})`;

/** Pins the skill profile (ADR 0017). Only `core` exists until profiles are authored. */
export const profileKeyColumn = () => text('profile_key').notNull().default('core');
export const profileKeyCheck = (name: string, column: PgColumn) =>
  check(name, sql`${column} ~ '^[a-z][a-z0-9_]{0,31}$'`);
