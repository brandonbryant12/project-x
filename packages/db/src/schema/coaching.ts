import {
  EngagementLifecycle,
  MAX_DESIGNATION_DAYS,
  type DesignationId,
  type EngagementId,
  type PersonId,
} from '@repo/domain';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  createdAt,
  instant,
  isoDate,
  oneOf,
  tenantIdColumn,
  updatedAt,
  versionColumn,
} from './columns.ts';
import { personFk } from './directory.ts';

/** The coaching mesh: any coach can engage anyone. Confers no reporting authority. */
export const engagement = pgTable(
  'engagement',
  {
    id: text('id').$type<EngagementId>().primaryKey(),
    tenantId: tenantIdColumn(),
    coachId: text('coach_id').$type<PersonId>().notNull(),
    coacheeId: text('coachee_id').$type<PersonId>().notNull(),
    proposedById: text('proposed_by_id').$type<PersonId>().notNull(),
    status: text('status').notNull(),
    note: text('note'),
    /** Eligibility counts from this business date (domain-model.md § Eligible observer). */
    acceptedOn: isoDate('accepted_on'),
    endedOn: isoDate('ended_on'),
    expiresAt: instant('expires_at'),
    version: versionColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('engagement_tenant_id_key').on(t.tenantId, t.id),
    unique('engagement_parties_key').on(t.tenantId, t.id, t.coachId, t.coacheeId),
    personFk('engagement_coach_fk', t.tenantId, t.coachId),
    personFk('engagement_coachee_fk', t.tenantId, t.coacheeId),
    personFk('engagement_proposed_by_fk', t.tenantId, t.proposedById),
    oneOf('engagement_status_check', t.status, EngagementLifecycle.states),
    check('engagement_not_self', sql`${t.coachId} <> ${t.coacheeId}`),
    check('engagement_proposer_is_party', sql`${t.proposedById} in (${t.coachId}, ${t.coacheeId})`),
    check('engagement_ended_shape', sql`(${t.status} = 'ended') = (${t.endedOn} is not null)`),
    check('engagement_interval', sql`${t.endedOn} is null or ${t.endedOn} >= ${t.acceptedOn}`),
    index('engagement_expiry_idx').on(t.status, t.expiresAt),
    check(
      'engagement_accepted_when_live',
      sql`(${t.status} in ('active', 'paused', 'ended')) = (${t.acceptedOn} is not null)`,
    ),
    index('engagement_coachee_idx').on(t.tenantId, t.coacheeId),
    index('engagement_coach_idx').on(t.tenantId, t.coachId),
    // One live engagement per pair of people, in either direction (I45).
    uniqueIndex('engagement_live_pair_unique')
      .on(
        t.tenantId,
        sql`least(${t.coachId}, ${t.coacheeId})`,
        sql`greatest(${t.coachId}, ${t.coacheeId})`,
      )
      .where(sql`${t.status} in ('proposed', 'active', 'paused')`),
  ],
);

/**
 * A colleague named by the subject's leader or engaged coach to observe the
 * subject for a bounded window (ADR 0020). Half-open [valid_from, valid_to);
 * `ended_on` closes it early. The integrity migration forbids overlapping
 * designations between the same two people in either direction.
 */
export const observerDesignation = pgTable(
  'observer_designation',
  {
    id: text('id').$type<DesignationId>().primaryKey(),
    tenantId: tenantIdColumn(),
    subjectId: text('subject_id').$type<PersonId>().notNull(),
    observerId: text('observer_id').$type<PersonId>().notNull(),
    designatedById: text('designated_by_id').$type<PersonId>().notNull(),
    /** How the designator was entitled on `valid_from`. */
    designatorBasis: text('designator_basis').notNull(),
    validFrom: isoDate('valid_from').notNull(),
    validTo: isoDate('valid_to').notNull(),
    endedOn: isoDate('ended_on'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('observer_designation_parties_key').on(t.tenantId, t.id, t.observerId, t.subjectId),
    personFk('observer_designation_subject_fk', t.tenantId, t.subjectId),
    personFk('observer_designation_observer_fk', t.tenantId, t.observerId),
    personFk('observer_designation_designated_by_fk', t.tenantId, t.designatedById),
    check('observer_designation_not_self', sql`${t.observerId} <> ${t.subjectId}`),
    check(
      'observer_designation_distinct_designator',
      sql`${t.designatedById} not in (${t.observerId}, ${t.subjectId})`,
    ),
    check(
      'observer_designation_window',
      sql`${t.validTo} > ${t.validFrom} and ${t.validTo} <= ${t.validFrom} + ${sql.raw(String(MAX_DESIGNATION_DAYS))}`,
    ),
    check(
      'observer_designation_ended',
      sql`${t.endedOn} is null or (${t.endedOn} >= ${t.validFrom} and ${t.endedOn} < ${t.validTo})`,
    ),
    check('observer_designation_basis_check', sql`${t.designatorBasis} in ('leader', 'coach')`),
    index('observer_designation_subject_idx').on(t.tenantId, t.subjectId),
    index('observer_designation_observer_idx').on(t.tenantId, t.observerId),
  ],
);
