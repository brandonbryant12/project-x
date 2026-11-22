import { SkillDomain } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { NotFound } from '../errors.ts';
import { CatalogInsights, SkillCard, SkillDetail, TemplateCard } from '../models/index.ts';

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
    HttpApiEndpoint.get('templates', '/activity-templates', {
      query: { q: Schema.optional(Schema.String) },
      success: Schema.Array(TemplateCard),
    }),
  )
  .middleware(Authenticated)
  .prefix('/catalog') {}
