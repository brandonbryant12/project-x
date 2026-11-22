import { Api } from '@repo/api';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import { buildCatalogInsights, buildSkillDetail, searchSkills, searchTemplates } from './views.ts';

export const CatalogHandlers = HttpApiBuilder.group(Api, 'catalog', (handlers) =>
  handlers
    .handle('skills', ({ query }) => searchSkills(query).pipe(apiErrorsOnly))
    .handle('insights', () => buildCatalogInsights().pipe(apiErrorsOnly))
    .handle('skill', ({ params }) => buildSkillDetail(params.slug).pipe(apiErrorsOnly))
    .handle('templates', ({ query }) => searchTemplates(query).pipe(apiErrorsOnly)),
);
