import { EngagementId, PersonId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Conflict, Forbidden, InvalidTransition, NotFound, Unprocessable } from '../errors.ts';
import {
  CoachingView,
  EngagementEventType,
  EngagementView,
  HomeView,
  TeamView,
} from '../models/index.ts';

export class SupportGroup extends HttpApiGroup.make('support')
  .add(
    HttpApiEndpoint.get('home', '/home', { success: HomeView }),
    HttpApiEndpoint.get('team', '/team', { success: TeamView }),
    HttpApiEndpoint.get('coaching', '/coaching', { success: CoachingView }),
    HttpApiEndpoint.post('proposeEngagement', '/engagements', {
      payload: Schema.Struct({
        coachId: PersonId,
        coacheeId: PersonId,
        note: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(600)))),
      }),
      success: EngagementView,
      error: [Forbidden, Conflict, Unprocessable, NotFound],
    }),
    HttpApiEndpoint.post('engagementEvent', '/engagements/:id/events', {
      params: { id: EngagementId },
      payload: Schema.Struct({ event: EngagementEventType }),
      success: EngagementView,
      error: [NotFound, Forbidden, InvalidTransition, Conflict],
    }),
  )
  .middleware(Authenticated) {}
