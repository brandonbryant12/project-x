import { Conflict, Forbidden, NotFound, Unprocessable, type Actor } from '@repo/api';
import { CoachingActor, DomainEventId, personActor, type TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq } from 'drizzle-orm';
import { Context, DateTime, Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { recordDomainEvent } from '../../platform/metrics.ts';
import { now } from '../../platform/time.ts';

/** Convert the HTTP session `Actor` into a serializable `@alchemy.run/domain` `CoachingActor` context. */
export const domainActorContext = (actor: Actor) =>
  Context.make(CoachingActor, personActor(actor.tenantId, actor.personId, actor.grants));

/** Current `DateTime.Utc` from the server clock for deterministic `Aggregate.predict` decisions. */
export const domainNow = Effect.map(now, (d) => DateTime.makeUnsafe(d.getTime()));

/** Map a typed `@alchemy.run/domain` `Rejection` onto our `@repo/api` HTTP error union. */
export const mapDomainRejection = (rejection: {
  readonly _tag: string;
}): Forbidden | Conflict | NotFound | Unprocessable => {
  const fields: Readonly<Record<string, unknown>> = { ...rejection };
  switch (rejection._tag) {
    case 'UnauthorizedActor':
      return new Forbidden({ message: String(fields['reason'] ?? 'Not permitted.') });
    case 'AlreadyExists':
      return new Conflict({
        message: `${String(fields['entity'] ?? 'Record')} already exists.`,
      });
    case 'InvalidTransition':
      return new Conflict({
        message: String(fields['reason'] ?? 'Action not allowed in the current state.'),
      });
    case 'NotFoundInDomain':
      return new NotFound({
        entity: String(fields['entity'] ?? 'record'),
        id: String(fields['id'] ?? ''),
      });
    case 'PrivacyViolation': {
      const reasons = Array.isArray(fields['reasons'])
        ? (fields['reasons'] as ReadonlyArray<string>).join('; ').toLowerCase()
        : 'client details';
      return new Unprocessable({
        message: `Your note appears to include client details (${reasons}). Remove them to continue.`,
        field: 'narrativeSaw',
      });
    }
    case 'InvalidDomainInput':
      return new Unprocessable({
        message: String(fields['reason'] ?? 'Invalid input.'),
        field: String(fields['field'] ?? 'input'),
      });
    default:
      return new Unprocessable({ message: `Domain rejected command (${rejection._tag}).` });
  }
};

export interface JournalEventInput {
  readonly aggregate: string;
  readonly aggregateId: string;
  readonly event: { readonly _tag: string };
  readonly commandId?: string;
  readonly correlationId?: string;
}

/**
 * Append one or more `@alchemy.run/domain` immutable fact events to `schema.domainEvent`
 * inside the caller's active Postgres transaction (ADR 0023).
 *
 * Assigns strictly monotonic `streamSeq` per `(tenantId, stream)` so events can be
 * replayed deterministically into new projections or re-evaluated under future rules.
 */
export const appendDomainEvents = Effect.fn('domain.appendEvents')(function* (
  tenantId: TenantId,
  items: ReadonlyArray<JournalEventInput>,
) {
  if (items.length === 0) return;
  const db = yield* Db;
  const occurredAt = yield* now;
  const defaultCorrelation = randomUUID();
  const seqByStream = new Map<string, number>();

  const rows: Array<typeof schema.domainEvent.$inferInsert> = [];
  for (const item of items) {
    const stream = `${item.aggregate}/${item.aggregateId}`;
    let lastSeq = seqByStream.get(stream);
    if (lastSeq === undefined) {
      const [latest] = yield* db
        .select({ streamSeq: schema.domainEvent.streamSeq })
        .from(schema.domainEvent)
        .where(
          and(eq(schema.domainEvent.tenantId, tenantId), eq(schema.domainEvent.stream, stream)),
        )
        .orderBy(desc(schema.domainEvent.streamSeq))
        .limit(1);
      lastSeq = latest?.streamSeq ?? 0;
    }
    const nextSeq = lastSeq + 1;
    seqByStream.set(stream, nextSeq);
    const commandId = item.commandId ?? randomUUID();
    const payload = Object.fromEntries(
      Object.entries(item.event).filter(([key]) => key !== '_tag'),
    );
    rows.push({
      id: DomainEventId.generate(),
      tenantId,
      stream,
      streamSeq: nextSeq,
      aggregate: item.aggregate,
      aggregateId: item.aggregateId,
      eventTag: item.event._tag,
      payload,
      commandId,
      correlationId: item.correlationId ?? defaultCorrelation,
      occurredAt,
    });
  }

  yield* db.insert(schema.domainEvent).values(rows);
  for (const row of rows) {
    yield* recordDomainEvent(row.aggregate, row.eventTag);
  }
});
