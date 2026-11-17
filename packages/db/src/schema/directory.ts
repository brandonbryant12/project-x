import {
  GRANT_ROLES,
  NOTIFICATION_CHANNELS,
  PERSON_STATUSES,
  type BusinessFunctionId,
  type JobFamilyId,
  type PositionId,
  type GrantRole,
  type PersonId,
  type ReportingLineId,
  type RoleGrantId,
  type SessionId,
  type TenantId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, isoDate, oneOf, tenantIdColumn, updatedAt } from './columns.ts';

export interface TenantSettings {
  readonly badgeCriteria?: {
    readonly minDemonstrations?: number;
    readonly minObservers?: number;
    readonly minFirstHandShare?: number;
    readonly minSpanDays?: number;
  };
  readonly observationWindowDays?: number;
  /** Entra group object id → grant, when app roles are unavailable (ADR 0006). */
  readonly groupGrants?: Readonly<Record<string, GrantRole>>;
}

export const tenant = pgTable(
  'tenant',
  {
    id: text('id').$type<TenantId>().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    entraTenantId: text('entra_tenant_id'),
    /** IANA zone that defines the firm's business day for `*_on` dates. */
    timeZone: text('time_zone').notNull().default('America/New_York'),
    settings: jsonb('settings').$type<TenantSettings>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('tenant_slug_unique').on(t.slug),
    uniqueIndex('tenant_entra_tenant_id_unique')
      .on(t.entraTenantId)
      .where(sql`${t.entraTenantId} is not null`),
  ],
);

export const businessFunction = pgTable(
  'business_function',
  {
    id: text('id').$type<BusinessFunctionId>().primaryKey(),
    tenantId: tenantIdColumn().references(() => tenant.id),
    name: text('name').notNull(),
  },
  (t) => [
    unique('business_function_tenant_id_key').on(t.tenantId, t.id),
    uniqueIndex('business_function_tenant_name_unique').on(t.tenantId, t.name),
  ],
);

/** Directory mirror of an Entra user. Never edited by product flows except status. */
export const person = pgTable(
  'person',
  {
    id: text('id').$type<PersonId>().primaryKey(),
    tenantId: tenantIdColumn().references(() => tenant.id),
    entraObjectId: text('entra_object_id'),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    title: text('title'),
    location: text('location'),
    businessFunctionId: text('business_function_id').$type<BusinessFunctionId>(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('person_tenant_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'person_business_function_fk',
      columns: [t.tenantId, t.businessFunctionId],
      foreignColumns: [businessFunction.tenantId, businessFunction.id],
    }),
    oneOf('person_status_check', t.status, PERSON_STATUSES),
    // Addresses can be reissued after someone leaves; sync keys on entra_object_id.
    uniqueIndex('person_tenant_email_unique')
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.status} <> 'departed'`),
    uniqueIndex('person_tenant_entra_unique')
      .on(t.tenantId, t.entraObjectId)
      .where(sql`${t.entraObjectId} is not null`),
    index('person_tenant_name_idx').on(t.tenantId, t.displayName),
  ],
);

/** Composite (tenant_id, <column>) → person FK. Makes cross-tenant references impossible. */
export const personFk = (
  name: string,
  tenantColumn: Parameters<typeof foreignKey>[0]['columns'][number],
  column: Parameters<typeof foreignKey>[0]['columns'][number],
) =>
  foreignKey({
    name,
    columns: [tenantColumn, column],
    foreignColumns: [person.tenantId, person.id],
  });

/** Effective-dated manager → report edge. Half-open [valid_from, valid_to). */
export const reportingLine = pgTable(
  'reporting_line',
  {
    id: text('id').$type<ReportingLineId>().primaryKey(),
    tenantId: tenantIdColumn(),
    managerId: text('manager_id').$type<PersonId>().notNull(),
    reportId: text('report_id').$type<PersonId>().notNull(),
    validFrom: isoDate('valid_from').notNull(),
    validTo: isoDate('valid_to'),
    source: text('source').notNull().default('directory'),
    syncedAt: instant('synced_at').notNull().defaultNow(),
  },
  (t) => [
    // Lets an observation's basis point at exactly this edge (observer = manager, subject = report).
    unique('reporting_line_parties_key').on(t.tenantId, t.id, t.managerId, t.reportId),
    personFk('reporting_line_manager_fk', t.tenantId, t.managerId),
    personFk('reporting_line_report_fk', t.tenantId, t.reportId),
    check('reporting_line_not_self', sql`${t.managerId} <> ${t.reportId}`),
    check('reporting_line_interval', sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
    // A person has at most one current manager.
    uniqueIndex('reporting_line_one_open_per_report')
      .on(t.tenantId, t.reportId)
      .where(sql`${t.validTo} is null`),
    index('reporting_line_manager_idx').on(t.tenantId, t.managerId),
  ],
);

/** Effective-dated capability mirrored from Entra app roles (ADR 0006). */
export const roleGrant = pgTable(
  'role_grant',
  {
    id: text('id').$type<RoleGrantId>().primaryKey(),
    tenantId: tenantIdColumn(),
    personId: text('person_id').$type<PersonId>().notNull(),
    role: text('role').$type<GrantRole>().notNull(),
    validFrom: isoDate('valid_from').notNull(),
    validTo: isoDate('valid_to'),
    source: text('source').notNull().default('entra'),
  },
  (t) => [
    personFk('role_grant_person_fk', t.tenantId, t.personId),
    oneOf('role_grant_role_check', t.role, GRANT_ROLES),
    uniqueIndex('role_grant_one_open')
      .on(t.tenantId, t.personId, t.role)
      .where(sql`${t.validTo} is null`),
  ],
);

/** Opaque session tokens; only the SHA-256 hash is stored (ADR 0014). */
export const session = pgTable(
  'session',
  {
    id: text('id').$type<SessionId>().primaryKey(),
    tenantId: tenantIdColumn(),
    personId: text('person_id').$type<PersonId>().notNull(),
    tokenHash: text('token_hash').notNull(),
    method: text('method').notNull(),
    createdAt: createdAt(),
    lastSeenAt: instant('last_seen_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
  },
  (t) => [
    personFk('session_person_fk', t.tenantId, t.personId),
    index('session_expires_idx').on(t.expiresAt),
    oneOf('session_method_check', t.method, ['entra', 'dev']),
    uniqueIndex('session_token_hash_unique').on(t.tokenHash),
  ],
);

/** A tenant's job-family taxonomy, from the HR feed (ADR 0017). */
export const jobFamily = pgTable(
  'job_family',
  {
    id: text('id').$type<JobFamilyId>().primaryKey(),
    tenantId: tenantIdColumn().references(() => tenant.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('job_family_tenant_id_key').on(t.tenantId, t.id),
    uniqueIndex('job_family_tenant_name_unique').on(t.tenantId, t.name),
    oneOf('job_family_status_check', t.status, ['active', 'retired']),
  ],
);

/**
 * Who a person was, and when: effective-dated, half-open, never overlapping
 * (exclusion constraint in the integrity migration). Credit pins the position
 * held on the interaction date, so history survives promotions (ADR 0017).
 */
export const personPosition = pgTable(
  'person_position',
  {
    id: text('id').$type<PositionId>().primaryKey(),
    tenantId: tenantIdColumn(),
    personId: text('person_id').$type<PersonId>().notNull(),
    jobFamilyId: text('job_family_id').$type<JobFamilyId>(),
    title: text('title'),
    businessFunctionId: text('business_function_id').$type<BusinessFunctionId>(),
    validFrom: isoDate('valid_from').notNull(),
    validTo: isoDate('valid_to'),
    source: text('source').notNull().default('directory'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('person_position_person_key').on(t.tenantId, t.id, t.personId),
    personFk('person_position_person_fk', t.tenantId, t.personId),
    foreignKey({
      name: 'person_position_job_family_fk',
      columns: [t.tenantId, t.jobFamilyId],
      foreignColumns: [jobFamily.tenantId, jobFamily.id],
    }),
    foreignKey({
      name: 'person_position_business_function_fk',
      columns: [t.tenantId, t.businessFunctionId],
      foreignColumns: [businessFunction.tenantId, businessFunction.id],
    }),
    check('person_position_interval', sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
    oneOf('person_position_source_check', t.source, ['directory', 'import', 'seed']),
    uniqueIndex('person_position_one_open')
      .on(t.tenantId, t.personId)
      .where(sql`${t.validTo} is null`),
  ],
);

/** How a person wants to hear from the app (ADR 0018). No row means the defaults. */
export const notificationPreference = pgTable(
  'notification_preference',
  {
    tenantId: tenantIdColumn(),
    personId: text('person_id').$type<PersonId>().primaryKey(),
    channel: text('channel').notNull().default('email'),
    weeklyDigest: boolean('weekly_digest').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [
    personFk('notification_preference_person_fk', t.tenantId, t.personId),
    oneOf('notification_preference_channel_check', t.channel, NOTIFICATION_CHANNELS),
  ],
);
