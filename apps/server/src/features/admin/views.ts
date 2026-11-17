import { CurrentActor, Forbidden, type Actor, type AiUsageRow } from '@repo/api';
import { toIsoDate, type IsoDate, type QuestionSetId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDaysIso, today } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { loadPeople } from '../shared/people.ts';

interface AiUsageQuery {
  readonly from?: IsoDate | undefined;
  readonly to?: IsoDate | undefined;
}

interface AuditTrailQuery {
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly limit?: number | undefined;
}

const requireGovernance = (actor: Actor) =>
  actor.grants.includes('tenant_admin') || actor.grants.includes('compliance_reviewer')
    ? Effect.void
    : Effect.fail(
        new Forbidden({ message: 'Only tenant admins and compliance reviewers can see this.' }),
      );

/** Assistant checks, failures and holds per day and question set, from decision records. */
const aiUsageReport = Effect.fn('admin.aiUsageReport')(function* (
  actor: Actor,
  from: IsoDate,
  to: IsoDate,
) {
  const db = yield* Db;
  const checks = yield* db
    .select()
    .from(schema.advisoryCheck)
    .where(
      and(
        eq(schema.advisoryCheck.tenantId, actor.tenantId),
        gte(schema.advisoryCheck.createdAt, new Date(`${from}T00:00:00Z`)),
        lt(schema.advisoryCheck.createdAt, new Date(`${addDaysIso(to, 1)}T00:00:00Z`)),
      ),
    );
  const groups = new Map<string, Array<(typeof checks)[number]>>();
  for (const check of checks) {
    const key = `${toIsoDate(check.createdAt)}|${check.questionSet}|${check.provider}`;
    groups.set(key, [...(groups.get(key) ?? []), check]);
  }
  const rows = [...groups.entries()].map(([key, group]): AiUsageRow => {
    const [day, questionSet, provider] = key.split('|') as [IsoDate, QuestionSetId, string];
    return {
      day,
      questionSet,
      provider,
      checks: group.length,
      failed: group.filter((c) => c.status === 'failed').length,
      holds: group.filter((c) => c.effect === 'hold' || c.effect === 'escalate').length,
    };
  });
  return {
    from,
    to,
    totalChecks: rows.reduce((n, r) => n + r.checks, 0),
    totalHolds: rows.reduce((n, r) => n + r.holds, 0),
    rows: rows.toSorted(
      (a, b) => b.day.localeCompare(a.day) || a.questionSet.localeCompare(b.questionSet),
    ),
  };
});

/** `GET /admin/ai-usage`: governance only, defaulting to the last 30 days. The read is audited. */
export const buildAiUsage = Effect.fn('admin.aiUsage')(function* (query: AiUsageQuery) {
  const actor = yield* CurrentActor;
  yield* requireGovernance(actor);
  const to = query.to ?? (yield* today);
  const from = query.from ?? addDaysIso(to, -30);
  yield* recordAudit(actor, {
    entityType: 'report',
    entityId: 'ai-usage',
    event: 'READ',
    data: { from, to },
  });
  return yield* aiUsageReport(actor, from, to);
});

/** `GET /admin/audit`: governance only, newest first. Reading the trail is itself audited. */
export const buildAuditTrail = Effect.fn('admin.auditTrail')(function* (query: AuditTrailQuery) {
  const actor = yield* CurrentActor;
  yield* requireGovernance(actor);
  const db = yield* Db;
  const conditions = [eq(schema.auditEvent.tenantId, actor.tenantId)];
  if (query.entityType) conditions.push(eq(schema.auditEvent.entityType, query.entityType));
  if (query.entityId) conditions.push(eq(schema.auditEvent.entityId, query.entityId));
  const rows = yield* db
    .select({ event: schema.auditEvent, note: schema.note.body })
    .from(schema.auditEvent)
    .leftJoin(schema.note, eq(schema.note.id, schema.auditEvent.noteId))
    .where(and(...conditions))
    .orderBy(desc(schema.auditEvent.seq))
    .limit(Math.min(query.limit ?? 100, 500));
  // Reading the audit trail is itself audited (ADR 0015).
  yield* recordAudit(actor, {
    entityType: 'report',
    entityId: 'audit-trail',
    event: 'READ',
    data: {
      entityType: query.entityType ?? null,
      entityId: query.entityId ?? null,
      rows: rows.length,
    },
  });
  const people = yield* loadPeople(
    actor.tenantId,
    rows.flatMap((r) => (r.event.actorId ? [r.event.actorId] : [])),
  );
  return rows.map(({ event, note }) => ({
    id: event.id,
    at: event.createdAt.toISOString(),
    actor: event.actorId ? (people.get(event.actorId) ?? null) : null,
    entityType: event.entityType,
    entityId: event.entityId,
    event: event.event,
    fromState: event.fromState,
    toState: event.toState,
    reason: note ?? event.reasonCode,
    policyVersion: event.policyVersion,
  }));
});
