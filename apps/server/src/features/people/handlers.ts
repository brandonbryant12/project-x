import { Api } from '@repo/api';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import { buildBadgeReceipt, buildProfile, buildTimeline, searchPeople } from './views.ts';

export const PeopleHandlers = HttpApiBuilder.group(Api, 'people', (handlers) =>
  handlers
    .handle('search', ({ query }) => searchPeople(query).pipe(apiErrorsOnly))
    .handle('profile', ({ params }) => buildProfile(params.id).pipe(apiErrorsOnly))
    .handle('badgeReceipt', ({ params }) =>
      buildBadgeReceipt(params.id, params.badgeId).pipe(apiErrorsOnly),
    )
    .handle('timeline', () => buildTimeline().pipe(apiErrorsOnly)),
);
