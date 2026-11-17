import { Api } from '@repo/api';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import { buildAdoption } from './adoption.ts';
import { designate, endDesignation, listDesignations } from './designations.ts';
import { listOutbox } from './outbox.ts';
import { myPreferences, updatePreferences } from './preferences.ts';

export const HubHandlers = HttpApiBuilder.group(Api, 'hub', (handlers) =>
  handlers
    .handle('designations', ({ params }) => listDesignations(params.id).pipe(apiErrorsOnly))
    .handle('designate', ({ payload }) => designate(payload).pipe(apiErrorsOnly))
    .handle('endDesignation', ({ params }) => endDesignation(params.id).pipe(apiErrorsOnly))
    .handle('preferences', () => myPreferences.pipe(apiErrorsOnly))
    .handle('updatePreferences', ({ payload }) => updatePreferences(payload).pipe(apiErrorsOnly))
    .handle('adoption', () => buildAdoption().pipe(apiErrorsOnly))
    .handle('outbox', ({ query }) => listOutbox(query.limit).pipe(apiErrorsOnly)),
);
