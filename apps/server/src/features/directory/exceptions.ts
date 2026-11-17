import {
  CurrentActor,
  Forbidden,
  NotFound,
  type Actor,
  type DirectoryExceptionView,
} from '@repo/api';
import {
  DirectoryExceptionId,
  DirectoryExceptionLifecycle,
  type DirectoryExceptionKind,
  type DirectoryExceptionStatus,
  type IsoDate,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { decide, requireUpdated } from '../shared/mutation.ts';
import { loadPeople } from '../shared/people.ts';
import { describeFinding, type Finding } from './findings.ts';

type ExceptionRow = typeof schema.directoryException.$inferSelect;

/** The directory is a tenant admin's job (ADR 0006); nobody else may change or read it here. */
export const requireTenantAdmin = (actor: Actor, message: string) =>
  actor.grants.includes('tenant_admin') ? Effect.void : Effect.fail(new Forbidden({ message }));

const LIVE: ReadonlyArray<DirectoryExceptionStatus> = ['open', 'acknowledged'];

/**
 * Records findings in the exceptions queue, inside the caller's transaction.
 * A finding that is already live (open or acknowledged) is not duplicated.
 */
export const persistFindings = Effect.fn('directory.persistFindings')(function* (
  actor: Actor,
  findings: ReadonlyArray<Finding>,
  detectedOn: IsoDate,
) {
  if (findings.length === 0) return 0;
  const db = yield* Db;
  const inserted = yield* db
    .insert(schema.directoryException)
    .values(
      findings.map((f) => ({
        id: DirectoryExceptionId.generate(),
        tenantId: actor.tenantId,
        kind: f.kind,
        personId: f.personId,
        email: f.email,
        dedupeKey: f.dedupeKey,
        data: f.data,
        detectedOn,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.directoryException.id, kind: schema.directoryException.kind });
  for (const row of inserted) {
    yield* recordAudit(actor, {
      entityType: 'directory_exception',
      entityId: row.id,
      event: 'CREATE',
      to: 'open',
      reasonCode: 'directory_change',
      data: { kind: row.kind },
    });
  }
  return inserted.length;
});

/**
 * After an applied import: live exceptions the file no longer produces are
 * resolved (HR fixed them), through the lifecycle and audited.
 */
export const resolveStale = Effect.fn('directory.resolveStale')(function* (
  actor: Actor,
  current: ReadonlyArray<Finding>,
) {
  const db = yield* Db;
  const keys = current.map((f) => f.dedupeKey);
  const stale = yield* db
    .select()
    .from(schema.directoryException)
    .where(
      and(
        eq(schema.directoryException.tenantId, actor.tenantId),
        inArray(schema.directoryException.status, [...LIVE]),
        ...(keys.length > 0 ? [notInArray(schema.directoryException.dedupeKey, keys)] : []),
      ),
    );
  const at = yield* now;
  for (const row of stale) {
    const from = row.status as DirectoryExceptionStatus;
    const to = yield* decide({
      lifecycle: DirectoryExceptionLifecycle,
      from,
      facts: {},
      event: { type: 'RESOLVE' },
      permitted: actor.grants.includes('tenant_admin'),
    });
    yield* db
      .update(schema.directoryException)
      .set({ status: to, resolvedAt: at })
      .where(
        and(eq(schema.directoryException.id, row.id), eq(schema.directoryException.status, from)),
      )
      .returning({ id: schema.directoryException.id })
      .pipe(Effect.flatMap(requireUpdated('directory exception')));
    yield* recordAudit(actor, {
      entityType: 'directory_exception',
      entityId: row.id,
      event: 'RESOLVE',
      from,
      to,
      reasonCode: 'directory_change',
    });
  }
  return stale.length;
});

const actionsFor = (actor: Actor, row: ExceptionRow): DirectoryExceptionView['actions'] =>
  actor.grants.includes('tenant_admin') &&
  DirectoryExceptionLifecycle.next(
    row.status as DirectoryExceptionStatus,
    {},
    {
      type: 'ACKNOWLEDGE',
    },
  ) !== null
    ? ['ACKNOWLEDGE']
    : [];

const toViews = Effect.fn('directory.exceptionViews')(function* (
  actor: Actor,
  rows: ReadonlyArray<ExceptionRow>,
) {
  const people = yield* loadPeople(
    actor.tenantId,
    rows.flatMap((r) => [r.personId, r.acknowledgedById].filter((id) => id !== null)),
  );
  return rows.map((row): DirectoryExceptionView => ({
    id: row.id,
    kind: row.kind,
    status: row.status as DirectoryExceptionStatus,
    person: row.personId ? (people.get(row.personId) ?? null) : null,
    email: row.email,
    detail: describeFinding(row.kind as DirectoryExceptionKind, row.email, row.data),
    detectedOn: row.detectedOn,
    acknowledgedBy: row.acknowledgedById ? (people.get(row.acknowledgedById) ?? null) : null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    actions: actionsFor(actor, row),
  }));
});

/** No status means the live queue (open and acknowledged). */
const statusFilter = (status: DirectoryExceptionStatus | 'all' | undefined) => {
  if (status === 'all') return undefined;
  if (status === undefined) return inArray(schema.directoryException.status, [...LIVE]);
  return eq(schema.directoryException.status, status);
};

export const listExceptions = Effect.fn('useCase.listDirectoryExceptions')(function* (
  status: DirectoryExceptionStatus | 'all' | undefined,
) {
  const actor = yield* CurrentActor;
  yield* requireTenantAdmin(actor, 'Only tenant admins can see directory exceptions.');
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.directoryException)
    .where(and(eq(schema.directoryException.tenantId, actor.tenantId), statusFilter(status)))
    .orderBy(desc(schema.directoryException.createdAt))
    .limit(500);
  return yield* toViews(actor, rows);
});

export const acknowledgeException = Effect.fn('useCase.acknowledgeDirectoryException')(function* (
  id: DirectoryExceptionId,
) {
  const actor = yield* CurrentActor;
  yield* requireTenantAdmin(actor, 'Only tenant admins can acknowledge directory exceptions.');
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.directoryException)
    .where(
      and(
        eq(schema.directoryException.tenantId, actor.tenantId),
        eq(schema.directoryException.id, id),
      ),
    );
  if (!row) return yield* Effect.fail(new NotFound({ entity: 'directory exception', id }));
  const from = row.status as DirectoryExceptionStatus;
  const to = yield* decide({
    lifecycle: DirectoryExceptionLifecycle,
    from,
    facts: {},
    event: { type: 'ACKNOWLEDGE' },
    permitted: true,
  });
  const at = yield* now;
  const updated = yield* transactionally(
    Effect.gen(function* () {
      const result = yield* db
        .update(schema.directoryException)
        .set({ status: to, acknowledgedById: actor.personId, acknowledgedAt: at })
        .where(
          and(eq(schema.directoryException.id, row.id), eq(schema.directoryException.status, from)),
        )
        .returning()
        .pipe(Effect.flatMap(requireUpdated('directory exception')));
      yield* recordAudit(actor, {
        entityType: 'directory_exception',
        entityId: row.id,
        event: 'ACKNOWLEDGE',
        from,
        to,
      });
      return result;
    }),
  );
  const [view] = yield* toViews(actor, [updated]);
  if (!view) return yield* Effect.die('invariant: directory exception view missing');
  return view;
});
