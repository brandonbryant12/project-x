import { Forbidden, type Actor, type ChangeView } from '@repo/api';
import type { TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { loadPeople } from '../shared/people.ts';

/** Program owners and tenant admins run the program's rules and catalog (design §7). */
export const isProgramAdmin = (actor: Actor) =>
  actor.grants.includes('program_owner') || actor.grants.includes('tenant_admin');

export const requireProgramAdmin = (actor: Actor) =>
  isProgramAdmin(actor)
    ? Effect.void
    : Effect.fail(
        new Forbidden({ message: 'Only program owners and tenant admins can change the program.' }),
      );

export type ChangedValue = string | number | boolean | null;
export interface FieldChange {
  readonly field: string;
  readonly before: ChangedValue;
  readonly after: ChangedValue;
}

/** The fields whose values differ, in the order of `after`, for the audit record. */
export const changedFields = (
  before: Readonly<Record<string, ChangedValue>>,
  after: Readonly<Record<string, ChangedValue>>,
): Array<FieldChange> =>
  Object.keys(after)
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));

const isChangedValue = (v: unknown): v is ChangedValue =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v);

const changesOf = (data: Readonly<Record<string, unknown>>): Array<FieldChange> => {
  const raw = data['changes'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c: unknown) => {
    if (c === null || typeof c !== 'object') return [];
    const { field, before, after } = c as Record<string, unknown>;
    return typeof field === 'string' && isChangedValue(before) && isChangedValue(after)
      ? [{ field, before, after }]
      : [];
  });
};

/**
 * The audited changes to one administered thing, newest first: who, when,
 * the reason they wrote (unless purged) and each field before and after.
 */
export const changeHistory = Effect.fn('program.changeHistory')(function* (
  tenantId: TenantId,
  entityType: string,
  entityId: string,
  limit = 20,
) {
  const db = yield* Db;
  const rows = yield* db
    .select({ event: schema.auditEvent, note: schema.note.body })
    .from(schema.auditEvent)
    .leftJoin(
      schema.note,
      and(
        eq(schema.note.tenantId, schema.auditEvent.tenantId),
        eq(schema.note.id, schema.auditEvent.noteId),
      ),
    )
    .where(
      and(
        eq(schema.auditEvent.tenantId, tenantId),
        eq(schema.auditEvent.entityType, entityType),
        eq(schema.auditEvent.entityId, entityId),
      ),
    )
    .orderBy(desc(schema.auditEvent.seq))
    .limit(limit);
  const people = yield* loadPeople(
    tenantId,
    rows.flatMap((r) => (r.event.actorId ? [r.event.actorId] : [])),
  );
  return rows.map(({ event, note }): ChangeView => ({
    id: event.id,
    at: event.createdAt.toISOString(),
    actor: event.actorId ? (people.get(event.actorId) ?? null) : null,
    event: event.event,
    reason: note ?? null,
    changes: changesOf(event.data),
  }));
});
