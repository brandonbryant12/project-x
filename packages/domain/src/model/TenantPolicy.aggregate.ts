import * as Domain from '@alchemy.run/domain';
import { Effect, Schema } from 'effect';
import { TenantId } from '../ids.ts';
import { DEFAULT_BADGE_CRITERIA } from '../scoring/badges.ts';
import { CoachingActor, CoachingSession } from './CoachingActor.context.ts';
import { BadgeCriteriaFact, InvalidDomainInput, UnauthorizedActor } from './Shared.ts';

export class TenantPolicyUpdated extends Domain.Event('TenantPolicyUpdated', {
  badgeCriteria: BadgeCriteriaFact,
  observationWindowDays: Schema.Int,
  hasAuditNote: Schema.Boolean,
}) {}

export class UpdateTenantPolicy extends Domain.Command(
  'UpdateTenantPolicy',
  {
    target: TenantId,
    middleware: [CoachingSession],
    input: {
      badgeCriteria: BadgeCriteriaFact,
      observationWindowDays: Schema.Int,
      auditNote: Schema.NullOr(Schema.String),
    },
    events: [TenantPolicyUpdated],
    rejects: [UnauthorizedActor, InvalidDomainInput],
    reply: {
      badgeCriteria: BadgeCriteriaFact,
      observationWindowDays: Schema.Int,
    },
  },
  { description: 'Update firm-wide badge rigor criteria and observation logging window.' },
) {}

export const TenantPolicyState = Schema.Struct({
  badgeCriteria: BadgeCriteriaFact,
  observationWindowDays: Schema.Int,
  revision: Schema.Int,
});
export type TenantPolicyState = typeof TenantPolicyState.Type;

export class TenantPolicy extends Domain.Aggregate(
  'TenantPolicy',
  {
    id: TenantId,
    state: TenantPolicyState,
    initial: {
      badgeCriteria: DEFAULT_BADGE_CRITERIA,
      observationWindowDays: 14,
      revision: 0,
    },
    commands: [UpdateTenantPolicy],
    decide: {
      UpdateTenantPolicy: Effect.fn(function* (_state, cmd) {
        const actor = yield* CoachingActor;
        if (actor.kind === 'person' && !actor.grants.includes('tenant_admin')) {
          return yield* new UnauthorizedActor({
            action: 'UpdateTenantPolicy',
            reason: 'Only tenant admins can update program policy.',
          });
        }
        const { badgeCriteria, observationWindowDays } = cmd;
        if (badgeCriteria.minDemonstrations < 1 || badgeCriteria.minDemonstrations > 8) {
          return yield* new InvalidDomainInput({
            field: 'badgeCriteria.minDemonstrations',
            reason: 'Minimum observations must be between 1 and 8.',
          });
        }
        if (
          badgeCriteria.minObservers < 1 ||
          badgeCriteria.minObservers > badgeCriteria.minDemonstrations
        ) {
          return yield* new InvalidDomainInput({
            field: 'badgeCriteria.minObservers',
            reason: 'Minimum distinct observers cannot exceed minimum observations.',
          });
        }
        if (badgeCriteria.minFirstHandShare < 0 || badgeCriteria.minFirstHandShare > 1) {
          return yield* new InvalidDomainInput({
            field: 'badgeCriteria.minFirstHandShare',
            reason: 'First-hand share must be between 0 and 1.',
          });
        }
        if (badgeCriteria.minSpanDays < 0 || badgeCriteria.minSpanDays > 180) {
          return yield* new InvalidDomainInput({
            field: 'badgeCriteria.minSpanDays',
            reason: 'Minimum span days must be between 0 and 180.',
          });
        }
        if (observationWindowDays < 3 || observationWindowDays > 60) {
          return yield* new InvalidDomainInput({
            field: 'observationWindowDays',
            reason: 'Observation logging window must be between 3 and 60 days.',
          });
        }
        return [
          new TenantPolicyUpdated({
            badgeCriteria,
            observationWindowDays,
            hasAuditNote: Boolean(cmd.auditNote?.trim()),
          }),
        ];
      }),
    },
    evolve: {
      TenantPolicyUpdated: (state, event) => ({
        badgeCriteria: event.badgeCriteria,
        observationWindowDays: event.observationWindowDays,
        revision: state.revision + 1,
      }),
    },
    reply: {
      UpdateTenantPolicy: (state) => ({
        badgeCriteria: state.badgeCriteria,
        observationWindowDays: state.observationWindowDays,
      }),
    },
  },
  { description: 'Firm-wide badge rigor criteria and observation logging window policy.' },
) {}
