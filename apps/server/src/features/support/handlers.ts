import { Api, CurrentActor } from '@repo/api';
import type { EngagementId } from '@repo/domain';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import { buildHome } from './home.ts';
import { buildCoaching, buildEngagementViews, buildTeam } from './team.ts';
import { engagementEvent, loadEngagement, proposeEngagement } from './use-cases.ts';

const engagementView = (id: EngagementId) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    const row = yield* loadEngagement(id);
    const [view] = yield* buildEngagementViews(actor, [row]);
    if (!view) return yield* Effect.die('invariant: engagement view missing');
    return view;
  });

const withActor = <A, E, R>(f: (actor: CurrentActor['Service']) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* f(yield* CurrentActor);
  }).pipe(apiErrorsOnly);

export const SupportHandlers = HttpApiBuilder.group(Api, 'support', (handlers) =>
  handlers
    .handle('home', () => withActor(buildHome))
    .handle('team', () => withActor(buildTeam))
    .handle('coaching', () => withActor(buildCoaching))
    .handle('proposeEngagement', ({ payload }) =>
      proposeEngagement(payload).pipe(Effect.flatMap(engagementView), apiErrorsOnly),
    )
    .handle('engagementEvent', ({ params, payload }) =>
      engagementEvent(params.id, payload.event).pipe(
        Effect.andThen(engagementView(params.id)),
        apiErrorsOnly,
      ),
    ),
);
