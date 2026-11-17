import { DesignationId, PersonId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Conflict, Forbidden, NotFound, Unprocessable } from '../errors.ts';
import {
  AdoptionView,
  DesignateInput,
  DesignationView,
  NotificationPreferences,
  OutboxRow,
} from '../models/index.ts';

/** Designated observers (ADR 0020), preferences (ADR 0018), adoption (ADR 0021). */
export class HubGroup extends HttpApiGroup.make('hub')
  .add(
    HttpApiEndpoint.get('designations', '/people/:id/designations', {
      params: { id: PersonId },
      success: Schema.Array(DesignationView),
      error: NotFound,
    }),
    HttpApiEndpoint.post('designate', '/designations', {
      payload: DesignateInput,
      success: DesignationView,
      error: [Forbidden, Unprocessable, Conflict, NotFound],
    }),
    HttpApiEndpoint.post('endDesignation', '/designations/:id/end', {
      params: { id: DesignationId },
      success: DesignationView,
      error: [NotFound, Forbidden, Conflict],
    }),
    HttpApiEndpoint.get('preferences', '/me/preferences', { success: NotificationPreferences }),
    HttpApiEndpoint.put('updatePreferences', '/me/preferences', {
      payload: NotificationPreferences,
      success: NotificationPreferences,
    }),
    /** Program owners and tenant admins. Aggregates only, minimum cell size five. */
    HttpApiEndpoint.get('adoption', '/adoption', { success: AdoptionView, error: Forbidden }),
    /** Tenant admins: what the outbox sent, rendered exactly as delivered. */
    HttpApiEndpoint.get('outbox', '/admin/outbox', {
      query: { limit: Schema.optional(Schema.NumberFromString) },
      success: Schema.Array(OutboxRow),
      error: Forbidden,
    }),
  )
  .middleware(Authenticated) {}
