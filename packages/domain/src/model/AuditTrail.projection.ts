import * as Domain from '@alchemy.run/domain';
import { DateTime, Effect } from 'effect';
import { TenantId } from '../ids.ts';
import { CoachingActor, CoachingSession } from './CoachingActor.context.ts';
import { CoachingEngagement, EngagementProposed } from './CoachingEngagement.aggregate.ts';
import {
  DevelopmentPlan,
  DevelopmentPlanCreated,
  DevelopmentPlanProposed,
} from './DevelopmentPlan.aggregate.ts';
import { Observation } from './Observation.aggregate.ts';
import {
  ObservationRequested,
  ObservationReturned,
  ObservationSigned,
  ObservationStarted,
  ObservationVoided,
} from './Observation.commands.ts';
import { AuditTrailRow, AuditTrailStore } from './Ports.ts';
import { UnauthorizedActor } from './Shared.ts';
import {
  PlaybookResourceAttached,
  PlaybookResourceRemoved,
  SkillCatalog,
  SkillPublished,
  SkillRetired,
  SkillVersionPublished,
} from './SkillCatalog.aggregate.ts';
import {
  BadgeAwarded,
  BadgeRevoked,
  DemonstrationRecorded,
  DemonstrationReversed,
  SkillLedger,
} from './SkillLedger.aggregate.ts';
import { TenantPolicy, TenantPolicyUpdated } from './TenantPolicy.aggregate.ts';

/**
 * Idempotent projection that records every auditable domain fact keyed by `stream:seq`
 * into `AuditTrailStore` (memory in stories, Postgres in server).
 */
export class AuditTrailProjection extends Domain.Projection(
  'AuditTrailProjection',
  {
    from: [
      Observation,
      SkillLedger,
      TenantPolicy,
      SkillCatalog,
      DevelopmentPlan,
      CoachingEngagement,
    ],
    key: TenantId,
    keyOf: {
      Observation: ({ event }) => ('tenantId' in event ? event.tenantId : undefined),
      SkillLedger: ({ event }) => event.tenantId,
      TenantPolicy: ({ source }) => source.id,
      SkillCatalog: ({ event }) => event.tenantId,
      DevelopmentPlan: ({ event }) => ('tenantId' in event ? event.tenantId : undefined),
      CoachingEngagement: ({ event }) => ('tenantId' in event ? event.tenantId : undefined),
    },
    on: [
      ObservationRequested,
      ObservationStarted,
      ObservationSigned,
      ObservationReturned,
      ObservationVoided,
      DemonstrationRecorded,
      DemonstrationReversed,
      BadgeAwarded,
      BadgeRevoked,
      TenantPolicyUpdated,
      SkillPublished,
      SkillVersionPublished,
      PlaybookResourceAttached,
      PlaybookResourceRemoved,
      SkillRetired,
      DevelopmentPlanCreated,
      DevelopmentPlanProposed,
      EngagementProposed,
    ],
  },
  { description: 'Idempotently projects every auditable coaching fact into the tenant audit log.' },
) {}

export const AuditTrailProjectionLive = AuditTrailProjection.toLayer(
  Effect.gen(function* () {
    const store = yield* AuditTrailStore;
    return Effect.fn(function* (batch) {
      yield* store.append(
        batch.map(({ key, event, envelope }) => ({
          id: `${envelope.stream}:${envelope.seq}`,
          tenantId: key,
          stream: envelope.stream,
          seq: envelope.seq,
          eventTag: event._tag,
          entityId: envelope.id,
          occurredAtMs: DateTime.toEpochMillis(envelope.at),
          commandId: envelope.commandId,
          correlationId: envelope.correlationId,
        })),
      );
    });
  }),
);

/** Paged tenant-scoped audit trail query guarded by tenant isolation and role grants. */
export class AuditTrailQuery extends Domain.Query(
  'AuditTrailQuery',
  {
    input: { tenantId: TenantId },
    success: AuditTrailRow,
    paged: true,
    waitsFor: [AuditTrailProjection],
    middleware: [CoachingSession],
    rejects: [UnauthorizedActor],
  },
  { description: 'Read a tenant’s chronological audit trail (admins & compliance reviewers).' },
) {}

export const AuditTrailQueryLive = AuditTrailQuery.toLayer(
  Effect.gen(function* () {
    const store = yield* AuditTrailStore;
    return Effect.fn(function* ({ tenantId }, page) {
      const actor = yield* CoachingActor;
      if (actor.kind === 'person') {
        if (actor.tenantId !== tenantId) {
          return yield* new UnauthorizedActor({
            action: 'AuditTrailQuery',
            reason: 'Cannot query audit trail for another tenant.',
          });
        }
        const canAudit =
          actor.grants.includes('tenant_admin') || actor.grants.includes('compliance_reviewer');
        if (!canAudit) {
          return yield* new UnauthorizedActor({
            action: 'AuditTrailQuery',
            reason: 'Only tenant admins or compliance reviewers may read the audit trail.',
          });
        }
      }
      return yield* store.listForTenant(tenantId, page);
    });
  }),
  { take: { default: 50, max: 200 } },
);
