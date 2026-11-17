import { Api } from '@repo/api';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import { readCreditPolicy, replaceCreditPolicy } from './credit-policy.ts';
import {
  createSkill,
  listSkills,
  readSkill,
  setSkillValues,
  skillTransition,
  updateSkill,
} from './skills.ts';
import {
  createTemplate,
  listTemplates,
  readTemplate,
  templateTransition,
  updateTemplate,
} from './templates.ts';

export const ProgramHandlers = HttpApiBuilder.group(Api, 'program', (handlers) =>
  handlers
    .handle('creditPolicy', () => readCreditPolicy().pipe(apiErrorsOnly))
    .handle('saveCreditPolicy', ({ payload }) => replaceCreditPolicy(payload).pipe(apiErrorsOnly))
    .handle('skills', () => listSkills().pipe(apiErrorsOnly))
    .handle('createSkill', ({ payload }) => createSkill(payload).pipe(apiErrorsOnly))
    .handle('skill', ({ params }) => readSkill(params.slug).pipe(apiErrorsOnly))
    .handle('updateSkill', ({ params, payload }) =>
      updateSkill(params.slug, payload).pipe(apiErrorsOnly),
    )
    .handle('setSkillValues', ({ params, payload }) =>
      setSkillValues(params.slug, payload).pipe(apiErrorsOnly),
    )
    .handle('skillTransition', ({ params, payload }) =>
      skillTransition(params.slug, payload).pipe(apiErrorsOnly),
    )
    .handle('templates', () => listTemplates().pipe(apiErrorsOnly))
    .handle('createTemplate', ({ payload }) => createTemplate(payload).pipe(apiErrorsOnly))
    .handle('template', ({ params }) => readTemplate(params.id).pipe(apiErrorsOnly))
    .handle('updateTemplate', ({ params, payload }) =>
      updateTemplate(params.id, payload).pipe(apiErrorsOnly),
    )
    .handle('templateTransition', ({ params, payload }) =>
      templateTransition(params.id, payload).pipe(apiErrorsOnly),
    ),
);
