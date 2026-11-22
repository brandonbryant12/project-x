import * as Domain from '@alchemy.run/domain';
import { Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import { PersonId, TenantId } from '../ids.ts';
import { GrantRole } from '../vocabulary.ts';

/**
 * Serializable actor carried into aggregate `decide`, view `validate`, and query handlers.
 * System policies provide a `kind: 'system'` actor so authorization stays explicit everywhere.
 */
export const ActorPayload = Schema.Struct({
  kind: Schema.Literals(['person', 'system']),
  tenantId: TenantId,
  personId: Schema.NullOr(PersonId),
  grants: Schema.Array(GrantRole),
});
export type ActorPayload = typeof ActorPayload.Type;

export class CoachingActor extends Domain.RequestContext<CoachingActor>()(
  'Coaching/Actor',
  ActorPayload,
) {}

export class CoachingUnauthorized extends Domain.Rejection(
  'CoachingUnauthorized',
  { reason: Schema.String },
  { httpApiStatus: 401, description: 'Valid coaching session required.' },
) {}

export class CoachingSession extends RpcMiddleware.Service<
  CoachingSession,
  { provides: CoachingActor }
>()('Coaching/Session', { error: CoachingUnauthorized }) {}

export const personActor = (
  tenantId: TenantId,
  personId: PersonId,
  grants: ReadonlyArray<GrantRole> = [],
): ActorPayload => ({ kind: 'person', tenantId, personId, grants });

export const systemActor = (
  tenantId: TenantId,
  personId: PersonId | null = null,
): ActorPayload => ({
  kind: 'system',
  tenantId,
  personId,
  grants: [],
});
