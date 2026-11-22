import { SkillDomain, SkillId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Conflict, Forbidden, NotFound, Unprocessable } from '../errors.ts';
import {
  AddSkillResourceInput,
  AuthorSkillInput,
  CatalogInsights,
  SkillCard,
  SkillDetail,
  TemplateCard,
  UpdateSkillInput,
} from '../models/index.ts';

export class CatalogGroup extends HttpApiGroup.make('catalog')
  .add(
    HttpApiEndpoint.get('skills', '/skills', {
      query: { q: Schema.optional(Schema.String), domain: Schema.optional(SkillDomain) },
      success: Schema.Array(SkillCard),
    }),
    HttpApiEndpoint.get('insights', '/insights', {
      success: CatalogInsights,
    }),
    HttpApiEndpoint.get('skill', '/skills/:slug', {
      params: { slug: Schema.String },
      success: SkillDetail,
      error: NotFound,
    }),
    HttpApiEndpoint.post('createSkill', '/skills', {
      payload: AuthorSkillInput,
      success: SkillDetail,
      error: [Forbidden, Conflict, Unprocessable],
    }),
    HttpApiEndpoint.patch('updateSkill', '/skills/:id', {
      params: { id: SkillId },
      payload: UpdateSkillInput,
      success: SkillDetail,
      error: [Forbidden, NotFound, Unprocessable],
    }),
    HttpApiEndpoint.post('addResource', '/skills/:id/resources', {
      params: { id: SkillId },
      payload: AddSkillResourceInput,
      success: SkillDetail,
      error: [Forbidden, NotFound, Unprocessable],
    }),
    HttpApiEndpoint.delete('removeResource', '/skills/:id/resources/:resourceId', {
      params: { id: SkillId, resourceId: Schema.String },
      success: SkillDetail,
      error: [Forbidden, NotFound],
    }),
    HttpApiEndpoint.get('templates', '/activity-templates', {
      query: { q: Schema.optional(Schema.String) },
      success: Schema.Array(TemplateCard),
    }),
  )
  .middleware(Authenticated)
  .prefix('/catalog') {}
