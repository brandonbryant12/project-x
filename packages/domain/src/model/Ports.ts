import * as Domain from '@alchemy.run/domain';
import { Context, Effect, Layer, Schema } from 'effect';
import { PersonId, TenantId } from '../ids.ts';
import { NotificationKind } from '../vocabulary.ts';

/**
 * External system for dispatching strictly content-free notifications (ADR 0018).
 * Never carries narrative text, ratings, or client PII — only entity IDs & kind.
 */
export class NotificationGateway extends Domain.ExternalSystem(
  'NotificationGateway',
  {
    dispatch: {
      args: {
        tenantId: TenantId,
        recipientId: PersonId,
        kind: NotificationKind,
        entityType: Schema.Literals(['observation', 'plan', 'engagement', 'digest']),
        entityId: Schema.String,
        actorId: Schema.NullOr(PersonId),
      },
      success: { queued: Schema.Boolean },
    },
  },
  { description: 'Content-free notification delivery port (ADR 0018).' },
) {}

export const AuditTrailRow = Schema.Struct({
  id: Schema.String,
  tenantId: TenantId,
  stream: Schema.String,
  seq: Schema.Int,
  eventTag: Schema.String,
  entityId: Schema.String,
  occurredAtMs: Schema.Number,
  commandId: Schema.String,
  correlationId: Schema.String,
});
export type AuditTrailRow = typeof AuditTrailRow.Type;

export interface AuditTrailPage {
  readonly entries: ReadonlyArray<AuditTrailRow>;
  readonly cursor: string | null;
}

/**
 * Port written by `AuditTrailProjection` and read by `AuditTrailQuery`.
 * In tests/stories: `MemoryAuditTrailStore`; in `@repo/server`: Postgres adapter.
 */
export class AuditTrailStore extends Context.Service<
  AuditTrailStore,
  {
    readonly append: (rows: ReadonlyArray<AuditTrailRow>) => Effect.Effect<void>;
    readonly listForTenant: (
      tenantId: TenantId,
      page: { readonly after: string | undefined; readonly take: number },
    ) => Effect.Effect<AuditTrailPage>;
  }
>()('Coaching/AuditTrailStore') {}

/** Deterministic in-memory audit store for `Story.make` and unit verification. */
export const MemoryAuditTrailStore = Layer.sync(AuditTrailStore, () => {
  const byId = new Map<string, AuditTrailRow>();
  return {
    append: (rows) =>
      Effect.sync(() => {
        for (const row of rows) byId.set(row.id, row);
      }),
    listForTenant: (tenantId, page) =>
      Effect.sync(() => {
        const all = [...byId.values()]
          .filter((r) => r.tenantId === tenantId)
          .toSorted((a, b) => a.occurredAtMs - b.occurredAtMs || a.id.localeCompare(b.id));
        const startIdx = page.after ? all.findIndex((r) => r.id === page.after) + 1 : 0;
        const slice = all.slice(startIdx, startIdx + page.take);
        const hasMore = startIdx + slice.length < all.length;
        return {
          entries: slice,
          cursor: hasMore ? (slice.at(-1)?.id ?? null) : null,
        };
      }),
  };
});
