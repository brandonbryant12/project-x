import { BadgeAwardId, PersonId, SkillId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { NotFound } from '../errors.ts';
import { BadgeReceiptView, PersonCard, ProfileView, TimelineItem } from '../models/index.ts';

export class PeopleGroup extends HttpApiGroup.make('people')
  .add(
    HttpApiEndpoint.get('search', '/people', {
      query: {
        q: Schema.optional(Schema.String),
        skillId: Schema.optional(SkillId),
        minLevel: Schema.optional(Schema.NumberFromString),
      },
      success: Schema.Array(PersonCard),
    }),
    HttpApiEndpoint.get('profile', '/people/:id', {
      params: { id: PersonId },
      success: ProfileView,
      error: NotFound,
    }),
    HttpApiEndpoint.get('badgeReceipt', '/people/:id/badges/:badgeId', {
      params: { id: PersonId, badgeId: BadgeAwardId },
      success: BadgeReceiptView,
      error: NotFound,
    }),
    HttpApiEndpoint.get('timeline', '/timeline', { success: Schema.Array(TimelineItem) }),
  )
  .middleware(Authenticated) {}
