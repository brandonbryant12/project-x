import { ActivityTemplateId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Conflict, Forbidden, InvalidTransition, NotFound, Unprocessable } from '../errors.ts';
import {
  CatalogTransitionInput,
  CreditPolicyAdminView,
  ProgramSkillDetail,
  ProgramSkillList,
  ProgramTemplateDetail,
  ProgramTemplateRow,
  SaveCreditPolicyInput,
  SetSkillValuesInput,
  SkillDetailsInput,
  TemplateInput,
  UpdateSkillInput,
  UpdateTemplateInput,
} from '../models/index.ts';

const writeErrors = [Forbidden, NotFound, Unprocessable, Conflict] as const;
const transitionErrors = [...writeErrors, InvalidTransition] as const;
const skill = { slug: Schema.String };
const template = { id: ActivityTemplateId };

/**
 * Program administration (design 2026-11-17 §7): program owners and tenant
 * admins change the credit rules and the catalog at run time. Everyone else
 * gets Forbidden. Every change is audited with before and after values.
 */
export class ProgramGroup extends HttpApiGroup.make('program')
  .add(
    HttpApiEndpoint.get('creditPolicy', '/credit-policy', {
      success: CreditPolicyAdminView,
      error: Forbidden,
    }),
    HttpApiEndpoint.put('saveCreditPolicy', '/credit-policy', {
      payload: SaveCreditPolicyInput,
      success: CreditPolicyAdminView,
      error: [Forbidden, Unprocessable, Conflict],
    }),
    HttpApiEndpoint.get('skills', '/skills', { success: ProgramSkillList, error: Forbidden }),
    HttpApiEndpoint.post('createSkill', '/skills', {
      payload: SkillDetailsInput,
      success: ProgramSkillDetail,
      error: writeErrors,
    }),
    HttpApiEndpoint.get('skill', '/skills/:slug', {
      params: skill,
      success: ProgramSkillDetail,
      error: [Forbidden, NotFound],
    }),
    HttpApiEndpoint.put('updateSkill', '/skills/:slug', {
      params: skill,
      payload: UpdateSkillInput,
      success: ProgramSkillDetail,
      error: writeErrors,
    }),
    HttpApiEndpoint.put('setSkillValues', '/skills/:slug/values', {
      params: skill,
      payload: SetSkillValuesInput,
      success: ProgramSkillDetail,
      error: writeErrors,
    }),
    HttpApiEndpoint.post('skillTransition', '/skills/:slug/transition', {
      params: skill,
      payload: CatalogTransitionInput,
      success: ProgramSkillDetail,
      error: transitionErrors,
    }),
    HttpApiEndpoint.get('templates', '/activity-templates', {
      success: Schema.Array(ProgramTemplateRow),
      error: Forbidden,
    }),
    HttpApiEndpoint.post('createTemplate', '/activity-templates', {
      payload: TemplateInput,
      success: ProgramTemplateDetail,
      error: writeErrors,
    }),
    HttpApiEndpoint.get('template', '/activity-templates/:id', {
      params: template,
      success: ProgramTemplateDetail,
      error: [Forbidden, NotFound],
    }),
    HttpApiEndpoint.put('updateTemplate', '/activity-templates/:id', {
      params: template,
      payload: UpdateTemplateInput,
      success: ProgramTemplateDetail,
      error: writeErrors,
    }),
    HttpApiEndpoint.post('templateTransition', '/activity-templates/:id/transition', {
      params: template,
      payload: CatalogTransitionInput,
      success: ProgramTemplateDetail,
      error: transitionErrors,
    }),
  )
  .middleware(Authenticated)
  .prefix('/program') {}
