import { Api } from '@repo/api';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import { addSkillResource, createSkill, removeSkillResource, updateSkill } from './use-cases.ts';
import { buildCatalogInsights, buildSkillDetail, searchSkills, searchTemplates } from './views.ts';

export const CatalogHandlers = HttpApiBuilder.group(Api, 'catalog', (handlers) =>
  handlers
    .handle('skills', ({ query }) => searchSkills(query).pipe(apiErrorsOnly))
    .handle('insights', () => buildCatalogInsights().pipe(apiErrorsOnly))
    .handle('skill', ({ params }) => buildSkillDetail(params.slug).pipe(apiErrorsOnly))
    .handle('createSkill', ({ payload }) => createSkill(payload).pipe(apiErrorsOnly))
    .handle('updateSkill', ({ params, payload }) =>
      updateSkill(params.id, payload).pipe(apiErrorsOnly),
    )
    .handle('addResource', ({ params, payload }) =>
      addSkillResource(params.id, payload).pipe(apiErrorsOnly),
    )
    .handle('removeResource', ({ params }) =>
      removeSkillResource(params.id, params.resourceId).pipe(apiErrorsOnly),
    )
    .handle('templates', ({ query }) => searchTemplates(query).pipe(apiErrorsOnly)),
);
