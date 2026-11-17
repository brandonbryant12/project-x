import {
  CurrentActor,
  Unprocessable,
  type Actor,
  type DirectoryImportInput,
  type DirectoryImportResult,
} from '@repo/api';
import {
  AuditEventId,
  BusinessFunctionId,
  JobFamilyId,
  PersonId,
  PositionId,
  ReportingLineId,
  type IsoDate,
  type TenantId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDaysIso, now, today } from '../../platform/time.ts';
import { digestOf } from '../shared/notes.ts';
import { parseDirectoryCsv } from './csv.ts';
import { departWithin, MAX_DEPARTURE_BACKDATE_DAYS, requireTenantAdmin } from './depart.ts';
import { toFindingView, uniqueFindings, type Finding } from './findings.ts';
import { planImport, type DirectorySnapshot, type ImportPlan } from './plan.ts';

/** Changes may be dated this far either side of today. */
const MAX_EFFECTIVE_OFFSET_DAYS = 30;
/** One import per tenant at a time (transaction-scoped advisory lock, as in the sweeps). */
const IMPORT_LOCK = 4_242_002;
const AUDIT_BATCH = 500;

const loadSnapshot = Effect.fn('directory.snapshot')(function* (tenantId: TenantId, on: IsoDate) {
  const db = yield* Db;
  const [people, businessFunctions, jobFamilies, openLines, openPositions, coaches] =
    yield* Effect.all([
      db.select().from(schema.person).where(eq(schema.person.tenantId, tenantId)),
      db
        .select({ id: schema.businessFunction.id, name: schema.businessFunction.name })
        .from(schema.businessFunction)
        .where(eq(schema.businessFunction.tenantId, tenantId)),
      db
        .select({ id: schema.jobFamily.id, name: schema.jobFamily.name })
        .from(schema.jobFamily)
        .where(eq(schema.jobFamily.tenantId, tenantId)),
      db
        .select()
        .from(schema.reportingLine)
        .where(
          and(eq(schema.reportingLine.tenantId, tenantId), isNull(schema.reportingLine.validTo)),
        ),
      db
        .select()
        .from(schema.personPosition)
        .where(
          and(eq(schema.personPosition.tenantId, tenantId), isNull(schema.personPosition.validTo)),
        ),
      db
        .select({ personId: schema.roleGrant.personId })
        .from(schema.roleGrant)
        .where(
          and(
            eq(schema.roleGrant.tenantId, tenantId),
            eq(schema.roleGrant.role, 'coach'),
            lte(schema.roleGrant.validFrom, on),
            or(isNull(schema.roleGrant.validTo), gt(schema.roleGrant.validTo, on)),
          ),
        ),
    ]);
  return {
    people,
    businessFunctions,
    jobFamilies,
    openLines,
    openPositions,
    coachIds: new Set(coaches.map((c) => c.personId)),
  } satisfies DirectorySnapshot;
});

/** Appends audit rows for an import in batches; same shape as `recordAudit`, no notes. */
const auditMany = Effect.fn('directory.auditMany')(function* (
  actor: Actor,
  events: ReadonlyArray<{
    readonly entityType: string;
    readonly entityId: string;
    readonly event: string;
    readonly data?: Readonly<Record<string, unknown>>;
  }>,
) {
  const db = yield* Db;
  for (let i = 0; i < events.length; i += AUDIT_BATCH) {
    yield* db.insert(schema.auditEvent).values(
      events.slice(i, i + AUDIT_BATCH).map((e) => ({
        id: AuditEventId.generate(),
        tenantId: actor.tenantId,
        actorId: actor.personId,
        entityType: e.entityType,
        entityId: e.entityId,
        event: e.event,
        reasonCode: 'directory_change' as const,
        data: e.data ?? {},
      })),
    );
  }
});

type AuditItem = Parameters<typeof auditMany>[1][number];

/** Adds the business functions and job families the file names for the first time. */
const createTaxonomy = Effect.fn('directory.taxonomy')(function* (
  tenantId: TenantId,
  plan: ImportPlan,
  snapshot: DirectorySnapshot,
  events: Array<AuditItem>,
) {
  const db = yield* Db;
  const functionIds = new Map(snapshot.businessFunctions.map((f) => [f.name, f.id]));
  const familyIds = new Map(snapshot.jobFamilies.map((f) => [f.name, f.id]));
  for (const name of plan.newBusinessFunctions) {
    const id = BusinessFunctionId.generate();
    yield* db.insert(schema.businessFunction).values({ id, tenantId, name });
    functionIds.set(name, id);
    events.push({ entityType: 'business_function', entityId: id, event: 'CREATE' });
  }
  for (const name of plan.newJobFamilies) {
    const id = JobFamilyId.generate();
    yield* db.insert(schema.jobFamily).values({ id, tenantId, name });
    familyIds.set(name, id);
    events.push({ entityType: 'job_family', entityId: id, event: 'CREATE' });
  }
  const functionId = (name: string | null) =>
    name === null ? null : (functionIds.get(name) ?? null);
  const familyId = (name: string | null) => (name === null ? null : (familyIds.get(name) ?? null));
  return { functionId, familyId };
});

/** Writes a plan. Runs inside the import transaction, after the lock. */
const applyPlan = Effect.fn('directory.apply')(function* (
  actor: Actor,
  plan: ImportPlan,
  snapshot: DirectorySnapshot,
  effectiveOn: IsoDate,
) {
  const db = yield* Db;
  const at = yield* now;
  const tenantId = actor.tenantId;
  const events: Array<AuditItem> = [];

  // Taxonomy first: people and positions point at it by name.
  const { functionId, familyId } = yield* createTaxonomy(tenantId, plan, snapshot, events);

  // People: new rows, then field updates.
  const idByEmail = new Map<string, PersonId>();
  const added = plan.people.filter((p) => p.existing === null);
  const newRows = added.map((p) => {
    const id = PersonId.generate();
    idByEmail.set(p.email, id);
    events.push({ entityType: 'person', entityId: id, event: 'CREATE' });
    return {
      id,
      tenantId,
      email: p.values.email,
      displayName: p.values.displayName,
      title: p.values.title,
      location: p.values.location,
      businessFunctionId: functionId(p.values.businessFunction),
      entraObjectId: p.values.entraObjectId,
    };
  });
  for (let i = 0; i < newRows.length; i += AUDIT_BATCH) {
    yield* db.insert(schema.person).values(newRows.slice(i, i + AUDIT_BATCH));
  }
  for (const p of plan.people) {
    if (!p.existing) continue;
    idByEmail.set(p.email, p.existing.id);
    if (p.changes.length === 0) continue;
    yield* db
      .update(schema.person)
      .set({
        email: p.values.email,
        displayName: p.values.displayName,
        title: p.values.title,
        location: p.values.location,
        businessFunctionId: functionId(p.values.businessFunction),
        entraObjectId: p.values.entraObjectId,
        ...(p.values.status && { status: p.values.status }),
        updatedAt: at,
      })
      .where(eq(schema.person.id, p.existing.id));
    // Field names only: the audit trail records what changed, the directory holds the values.
    events.push({
      entityType: 'person',
      entityId: p.existing.id,
      event: p.values.status ? 'REHIRE' : 'UPDATE',
      data: { fields: p.changes.map((c) => c.field) },
    });
  }

  // Effective dating: the old line or position ends on the effective date and the new one starts.
  const linesById = new Map(snapshot.openLines.map((l) => [l.id, l]));
  for (const change of plan.lines) {
    const reportId = idByEmail.get(change.email) as PersonId;
    const old = change.endLineId ? linesById.get(change.endLineId) : undefined;
    if (old) {
      if (old.validFrom < effectiveOn) {
        yield* db
          .update(schema.reportingLine)
          .set({ validTo: effectiveOn, syncedAt: at })
          .where(eq(schema.reportingLine.id, old.id));
      } else {
        yield* db.delete(schema.reportingLine).where(eq(schema.reportingLine.id, old.id));
      }
      events.push({
        entityType: 'reporting_line',
        entityId: old.id,
        event: 'END',
        data: { managerId: old.managerId, reportId: old.reportId, validTo: effectiveOn },
      });
    }
    if (change.managerEmail === null) continue;
    const managerId = idByEmail.get(change.managerEmail) as PersonId;
    const id = ReportingLineId.generate();
    yield* db.insert(schema.reportingLine).values({
      id,
      tenantId,
      managerId,
      reportId,
      validFrom: effectiveOn,
      source: 'import',
      syncedAt: at,
    });
    events.push({
      entityType: 'reporting_line',
      entityId: id,
      event: 'START',
      data: { managerId, reportId, validFrom: effectiveOn },
    });
  }
  const positionsById = new Map(snapshot.openPositions.map((p) => [p.id, p]));
  for (const change of plan.positions) {
    const personId = idByEmail.get(change.email) as PersonId;
    const old = change.endPositionId ? positionsById.get(change.endPositionId) : undefined;
    if (old) {
      if (old.validFrom < effectiveOn) {
        yield* db
          .update(schema.personPosition)
          .set({ validTo: effectiveOn })
          .where(eq(schema.personPosition.id, old.id));
      } else {
        yield* db.delete(schema.personPosition).where(eq(schema.personPosition.id, old.id));
      }
      events.push({ entityType: 'person_position', entityId: old.id, event: 'END' });
    }
    const id = PositionId.generate();
    yield* db.insert(schema.personPosition).values({
      id,
      tenantId,
      personId,
      title: change.to.title,
      jobFamilyId: familyId(change.to.jobFamily),
      businessFunctionId: functionId(change.to.businessFunction),
      validFrom: effectiveOn,
      source: 'import',
    });
    events.push({
      entityType: 'person_position',
      entityId: id,
      event: 'START',
      data: { personId, validFrom: effectiveOn },
    });
  }
  yield* auditMany(actor, events);

  // Departures last, so reports already moved to a new manager are not left behind.
  const findings: Array<Finding> = [];
  for (const personId of plan.departures) {
    const departure = yield* departWithin(actor, personId, effectiveOn, 'import');
    findings.push(...departure.findings);
  }
  const departed = new Set(plan.departures);
  return findings.filter((f) => f.personId === null || !departed.has(f.personId));
});

/**
 * `POST /admin/directory/import`: a full HR snapshot as CSV (ADR 0006). A dry
 * run returns the diff and the findings (rules the HR data breaks) and writes
 * nothing, not even an audit row. An applied run writes every change, audited,
 * in one transaction, and returns the findings too. Findings are never stored:
 * the admin fixes them in HR and re-runs the dry run.
 */
export const importDirectory = Effect.fn('useCase.importDirectory')(function* (
  input: DirectoryImportInput,
) {
  const actor = yield* CurrentActor;
  yield* requireTenantAdmin(actor, 'Only tenant admins can import the directory.');
  const on = yield* today;
  const effectiveOn = input.effectiveOn ?? on;
  if (
    effectiveOn < addDaysIso(on, -MAX_EFFECTIVE_OFFSET_DAYS) ||
    effectiveOn > addDaysIso(on, MAX_EFFECTIVE_OFFSET_DAYS)
  ) {
    return yield* Effect.fail(
      new Unprocessable({
        message: `Changes can take effect at most ${MAX_EFFECTIVE_OFFSET_DAYS} days either side of today.`,
        field: 'effectiveOn',
      }),
    );
  }
  const applyDepartures = input.applyDepartures ?? false;
  if (
    applyDepartures &&
    (effectiveOn > on || effectiveOn < addDaysIso(on, -MAX_DEPARTURE_BACKDATE_DAYS))
  ) {
    return yield* Effect.fail(
      new Unprocessable({
        message:
          'Departures take effect today or earlier. Import without departures, or change the date.',
        field: 'effectiveOn',
      }),
    );
  }
  const parsed = parseDirectoryCsv(input.csv);
  if (!parsed.ok) {
    return yield* Effect.fail(new Unprocessable({ message: parsed.message, field: 'csv' }));
  }
  const plan = (snapshot: DirectorySnapshot) =>
    planImport({ rows: parsed.rows, snapshot, applyDepartures, actorId: actor.personId });
  const result = (p: ImportPlan, findings: ReadonlyArray<Finding>, applied: boolean) =>
    ({
      dryRun: input.dryRun,
      applied,
      effectiveOn,
      rows: p.rows,
      diff: p.diff,
      exceptions: uniqueFindings(findings).map(toFindingView),
      departuresApplied: applied ? p.departures.length : 0,
    }) satisfies DirectoryImportResult;

  if (input.dryRun) {
    const preview = plan(yield* loadSnapshot(actor.tenantId, effectiveOn));
    return result(preview, preview.findings, false);
  }

  const db = yield* Db;
  return yield* transactionally(
    Effect.gen(function* () {
      yield* db.execute(
        sql`select pg_advisory_xact_lock(${IMPORT_LOCK}, hashtext(${actor.tenantId}))`,
      );
      const snapshot = yield* loadSnapshot(actor.tenantId, effectiveOn);
      const applied = plan(snapshot);
      const departureFindings = yield* applyPlan(actor, applied, snapshot, effectiveOn);
      const findings = uniqueFindings([...applied.findings, ...departureFindings]);
      yield* auditMany(actor, [
        {
          entityType: 'directory_import',
          entityId: digestOf(input.csv).slice(0, 32),
          event: 'IMPORT',
          data: {
            effectiveOn,
            rows: applied.rows,
            added: applied.diff.added.length,
            updated: applied.diff.updated.length,
            managerChanges: applied.diff.managerChanges.length,
            positionChanges: applied.diff.positionChanges.length,
            departureCandidates: applied.diff.departed.length,
            departed: applied.departures.length,
            exceptions: findings.length,
          },
        },
      ]);
      return result(applied, findings, true);
    }),
  );
});
