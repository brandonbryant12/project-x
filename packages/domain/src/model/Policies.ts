import * as Domain from '@alchemy.run/domain';
import { Effect } from 'effect';
import { DEFAULT_BADGE_CRITERIA } from '../scoring/badges.ts';
import { CoachingEngagement, EngagementProposed } from './CoachingEngagement.aggregate.ts';
import { DevelopmentPlan, DevelopmentPlanProposed } from './DevelopmentPlan.aggregate.ts';
import { Observation } from './Observation.aggregate.ts';
import {
  ObservationRequested,
  ObservationReturned,
  ObservationSigned,
  ObservationVoided,
} from './Observation.commands.ts';
import { NotificationGateway } from './Ports.ts';
import { skillLedgerId } from './Shared.ts';
import { RecordDemonstration, ReverseDemonstration, SkillLedger } from './SkillLedger.aggregate.ts';
import { TenantPolicy } from './TenantPolicy.aggregate.ts';

/**
 * Standing rule (ADR 0007, Invariant I2):
 * - When `ObservationSigned` commits → post raw demonstrations into `SkillLedger`
 *   using the tenant's active `TenantPolicy` criteria (evaluating badges automatically).
 * - When `ObservationVoided` commits → reverse credit in `SkillLedger` and revoke
 *   any badge whose criteria no longer hold.
 */
export class ObservationCreditPolicy extends Domain.Policy(
  'ObservationCreditPolicy',
  {
    from: Observation,
    on: [ObservationSigned, ObservationVoided],
  },
  {
    description:
      'Posts credit on ObservationSigned and reverses credit + revokes unmet badges on ObservationVoided.',
  },
) {}

export const ObservationCreditPolicyLive = ObservationCreditPolicy.toLayer(
  Effect.gen(function* () {
    const ledgers = yield* SkillLedger;
    const policies = yield* TenantPolicy;
    return Effect.fn(function* ({ source, event }) {
      const tenantPolicy = yield* policies.get(TenantPolicy.ref(event.tenantId)).pipe(
        Effect.map((s) => s.badgeCriteria),
        Effect.orElseSucceed(() => DEFAULT_BADGE_CRITERIA),
      );
      if (event._tag === 'ObservationSigned') {
        for (const rating of event.ratings.filter((r) => r.credit)) {
          const ledgerRef = SkillLedger.ref(
            skillLedgerId(event.tenantId, event.subjectId, rating.skillId),
          );
          yield* ledgers.send(
            ledgerRef,
            new RecordDemonstration({
              observationId: source.id,
              interactionId: event.interactionId,
              observerId: event.observerId,
              level: rating.level,
              mode: event.mode,
              demonstratedOn: event.occurredOn,
              criteria: tenantPolicy,
            }),
          );
        }
        return;
      }
      for (const skillId of event.creditedSkillIds) {
        const ledgerRef = SkillLedger.ref(skillLedgerId(event.tenantId, event.subjectId, skillId));
        yield* ledgers.send(
          ledgerRef,
          new ReverseDemonstration({
            observationId: source.id,
            reasonCode: 'observation_voided',
            criteria: tenantPolicy,
          }),
        );
      }
    });
  }),
);

/**
 * Standing rule (ADR 0018, Invariant I20):
 * Dispatches strictly content-free notifications whenever key coaching milestones happen.
 */
export class CoachingNotificationPolicy extends Domain.Policy(
  'CoachingNotificationPolicy',
  {
    from: [Observation, DevelopmentPlan, CoachingEngagement],
    on: [
      ObservationRequested,
      ObservationSigned,
      ObservationReturned,
      DevelopmentPlanProposed,
      EngagementProposed,
    ],
  },
  { description: 'Dispatches content-free coaching notifications via NotificationGateway.' },
) {}

export const CoachingNotificationPolicyLive = CoachingNotificationPolicy.toLayer(
  Effect.gen(function* () {
    const gateway = yield* NotificationGateway;
    return Effect.fn(function* ({ source, event }) {
      if (event._tag === 'ObservationRequested') {
        yield* gateway
          .dispatch({
            tenantId: event.tenantId,
            recipientId: event.observerId,
            kind: 'observation_requested',
            entityType: 'observation',
            entityId: source.id,
            actorId: event.requestedById,
          })
          .pipe(Effect.ignore);
        return;
      }
      if (event._tag === 'ObservationSigned') {
        yield* gateway
          .dispatch({
            tenantId: event.tenantId,
            recipientId: event.subjectId,
            kind: 'observation_signed',
            entityType: 'observation',
            entityId: source.id,
            actorId: event.observerId,
          })
          .pipe(Effect.ignore);
        return;
      }
      if (event._tag === 'ObservationReturned') {
        yield* gateway
          .dispatch({
            tenantId: event.tenantId,
            recipientId: event.requestedById,
            kind: 'observation_returned',
            entityType: 'observation',
            entityId: source.id,
            actorId: event.returnedById,
          })
          .pipe(Effect.ignore);
        return;
      }
      if (event._tag === 'DevelopmentPlanProposed') {
        yield* gateway
          .dispatch({
            tenantId: event.tenantId,
            recipientId: event.ownerId,
            kind: 'plan_proposed',
            entityType: 'plan',
            entityId: source.id,
            actorId: event.ownerId,
          })
          .pipe(Effect.ignore);
        return;
      }
      yield* gateway
        .dispatch({
          tenantId: event.tenantId,
          recipientId: event.coacheeId,
          kind: 'engagement_proposed',
          entityType: 'engagement',
          entityId: source.id,
          actorId: event.coachId,
        })
        .pipe(Effect.ignore);
    });
  }),
);
