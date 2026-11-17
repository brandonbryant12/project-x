import { AuditEventId, type TenantId, type PersonId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { Effect } from 'effect';
import { addNote, type NoteKind } from './notes.ts';

type AuditReasonCode = NonNullable<typeof schema.auditEvent.$inferInsert.reasonCode>;

/**
 * Append an audit event (ADR 0012, 0015) inside the same transaction as the
 * change it records. Human-written reasons go to `note` (purgeable) and are
 * linked; the audit row itself never contains narratives, evidence or PII.
 */
export const recordAudit = Effect.fn('audit.record')(function* (
  actor: { readonly tenantId: TenantId; readonly personId: PersonId | null },
  event: {
    readonly entityType: string;
    readonly entityId: string;
    readonly event: string;
    readonly from?: string | null;
    readonly to?: string | null;
    readonly data?: Readonly<Record<string, unknown>>;
    readonly reasonCode?: AuditReasonCode;
    readonly note?: { readonly kind: NoteKind; readonly body: string };
    readonly policyVersion?: string | null;
  },
) {
  const db = yield* Db;
  const noteId =
    event.note && actor.personId
      ? yield* addNote(
          { tenantId: actor.tenantId, personId: actor.personId },
          { entityType: event.entityType, entityId: event.entityId, ...event.note },
        )
      : null;
  yield* db.insert(schema.auditEvent).values({
    id: AuditEventId.generate(),
    tenantId: actor.tenantId,
    actorId: actor.personId,
    entityType: event.entityType,
    entityId: event.entityId,
    event: event.event,
    fromState: event.from ?? null,
    toState: event.to ?? null,
    reasonCode: noteId ? 'note' : (event.reasonCode ?? null),
    noteId,
    policyVersion: event.policyVersion ?? null,
    data: event.data ?? {},
  });
});
