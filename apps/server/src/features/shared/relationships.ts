import type { IsoDate, ObserverBasis, PersonId, RelationshipFacts, TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { Effect } from 'effect';

/**
 * Loads every relationship edge for a tenant. Tenants have thousands of people,
 * not millions; one indexed scan per request keeps all relationship rules in the
 * pure domain policy (packages/domain/src/policy).
 *
 * Engagements count from their acceptance date until they end. A paused
 * engagement still counts: the relationship exists, only sessions are paused.
 */
export const loadRelationshipFacts = Effect.fn('relationships.load')(function* (
  tenantId: TenantId,
) {
  const db = yield* Db;
  const [lines, engagements, grants, designations] = yield* Effect.all(
    [
      db.select().from(schema.reportingLine).where(eq(schema.reportingLine.tenantId, tenantId)),
      db
        .select()
        .from(schema.engagement)
        .where(
          and(
            eq(schema.engagement.tenantId, tenantId),
            inArray(schema.engagement.status, ['active', 'paused', 'ended']),
            isNotNull(schema.engagement.acceptedOn),
          ),
        ),
      db
        .select()
        .from(schema.roleGrant)
        .where(and(eq(schema.roleGrant.tenantId, tenantId), eq(schema.roleGrant.role, 'coach'))),
      db
        .select()
        .from(schema.observerDesignation)
        .where(eq(schema.observerDesignation.tenantId, tenantId)),
    ],
    { concurrency: 'unbounded' },
  );
  const facts: RelationshipFacts = {
    reportingLines: lines.map((l) => ({
      managerId: l.managerId,
      reportId: l.reportId,
      from: l.validFrom,
      to: l.validTo,
    })),
    engagements: engagements.map((e) => ({
      coachId: e.coachId,
      coacheeId: e.coacheeId,
      from: e.acceptedOn as IsoDate,
      to: e.endedOn,
    })),
    coachGrants: grants.map((g) => ({ personId: g.personId, from: g.validFrom, to: g.validTo })),
    // An early end shortens the window (ADR 0020).
    designations: designations.map((x) => ({
      observerId: x.observerId,
      subjectId: x.subjectId,
      from: x.validFrom,
      to: x.endedOn ?? x.validTo,
    })),
  };
  return facts;
});

/**
 * The exact edge that makes `observerId` eligible for `subjectId` on `on` — stored
 * on the observation so eligibility can be re-proved later (schema review #5).
 */
export const basisEdge = Effect.fn('relationships.basisEdge')(function* (
  tenantId: TenantId,
  input: { observerId: PersonId; subjectId: PersonId; on: IsoDate; basis: ObserverBasis },
) {
  const db = yield* Db;
  const none = { basisReportingLineId: null, basisEngagementId: null, basisDesignationId: null };
  if (input.basis === 'designated') {
    const rows = yield* db
      .select()
      .from(schema.observerDesignation)
      .where(
        and(
          eq(schema.observerDesignation.tenantId, tenantId),
          eq(schema.observerDesignation.observerId, input.observerId),
          eq(schema.observerDesignation.subjectId, input.subjectId),
        ),
      );
    const found = rows.find((x) => x.validFrom <= input.on && input.on < (x.endedOn ?? x.validTo));
    return { ...none, basisDesignationId: found?.id ?? null };
  }
  if (input.basis === 'leader') {
    const lines = yield* db
      .select()
      .from(schema.reportingLine)
      .where(
        and(
          eq(schema.reportingLine.tenantId, tenantId),
          eq(schema.reportingLine.managerId, input.observerId),
          eq(schema.reportingLine.reportId, input.subjectId),
        ),
      );
    const line = lines.find(
      (l) => l.validFrom <= input.on && (l.validTo === null || input.on < l.validTo),
    );
    return { ...none, basisReportingLineId: line?.id ?? null };
  }
  const engagements = yield* db
    .select()
    .from(schema.engagement)
    .where(
      and(
        eq(schema.engagement.tenantId, tenantId),
        eq(schema.engagement.coachId, input.observerId),
        eq(schema.engagement.coacheeId, input.subjectId),
        isNotNull(schema.engagement.acceptedOn),
      ),
    );
  const found = engagements.find(
    (e) => (e.acceptedOn as IsoDate) <= input.on && (e.endedOn === null || input.on < e.endedOn),
  );
  return { ...none, basisEngagementId: found?.id ?? null };
});
