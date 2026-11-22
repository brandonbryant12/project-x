import * as Domain from '@alchemy.run/domain';
import { Layer } from 'effect';
import {
  AuditTrailProjection,
  AuditTrailProjectionLive,
  AuditTrailQuery,
  AuditTrailQueryLive,
} from './AuditTrail.projection.ts';
import { CoachingEngagement } from './CoachingEngagement.aggregate.ts';
import { DevelopmentPlan } from './DevelopmentPlan.aggregate.ts';
import { Observation } from './Observation.aggregate.ts';
import {
  CoachingNotificationPolicy,
  CoachingNotificationPolicyLive,
  ObservationCreditPolicy,
  ObservationCreditPolicyLive,
} from './Policies.ts';
import { SkillCatalog } from './SkillCatalog.aggregate.ts';
import { SkillLedger } from './SkillLedger.aggregate.ts';
import { TenantPolicy } from './TenantPolicy.aggregate.ts';
import {
  ObservationSummaryView,
  ObservationSummaryViewLive,
  PersonMasteryView,
  PersonMasteryViewLive,
  TenantCatalogView,
} from './Views.ts';

/**
 * Coaching Catalyst Bounded Context (`@alchemy.run/domain` Model):
 * - 6 Aggregates: Observation, SkillLedger, TenantPolicy, SkillCatalog, DevelopmentPlan, CoachingEngagement
 * - 3 Live Views: PersonMasteryView, ObservationSummaryView, TenantCatalogView
 * - 2 Standing Policies: ObservationCreditPolicy, CoachingNotificationPolicy
 * - 1 Idempotent Projection + Query: AuditTrailProjection / AuditTrailQuery
 *
 * Hostable on `Domain.InMemory` (stories, tests) or `@alchemy.run/domain/EffectCluster` (Postgres).
 */
export class CoachingModel extends Domain.Model(
  'Coaching',
  {
    aggregates: [
      Observation,
      SkillLedger,
      TenantPolicy,
      SkillCatalog,
      DevelopmentPlan,
      CoachingEngagement,
    ],
    views: [PersonMasteryView, ObservationSummaryView, TenantCatalogView],
    policies: [ObservationCreditPolicy, CoachingNotificationPolicy],
    projections: [AuditTrailProjection],
    queries: [AuditTrailQuery],
  },
  {
    description:
      'Regulated financial-advisory coaching, skill credentialing, and development bounded context.',
  },
) {}

/** Every policy, view validator, projection, and query handler merged as one Effect Layer. */
export const CoachingHandlers = Layer.mergeAll(
  ObservationCreditPolicyLive,
  CoachingNotificationPolicyLive,
  PersonMasteryViewLive,
  ObservationSummaryViewLive,
  AuditTrailProjectionLive,
  AuditTrailQueryLive,
);

/** Typed Domain API surface ready for `clientInProcess`, `protocolHttp`, `toMcp`, and `toCli`. */
export class CoachingApi extends Domain.Api(
  'CoachingApi',
  {
    model: CoachingModel,
    views: ['PersonMasteryView', 'ObservationSummaryView', 'TenantCatalogView'],
    queries: ['AuditTrailQuery'],
  },
  { description: 'Coaching Catalyst domain API for in-process callers, HTTP, MCP, and CLI.' },
) {}
