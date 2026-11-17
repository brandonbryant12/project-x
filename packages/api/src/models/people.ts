import { BadgeAwardId, GrantRole, IsoDate, ObservationId, ObservationMode } from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary, ProgressView, SkillRef } from './common.ts';

export const BadgeView = Schema.Struct({
  id: BadgeAwardId,
  skill: SkillRef,
  level: Schema.Number,
  levelName: Schema.String,
  awardedAt: Instant,
});
export type BadgeView = typeof BadgeView.Type;

export const PersonCard = Schema.Struct({
  person: PersonSummary,
  businessFunction: Schema.NullOr(Schema.String),
  location: Schema.NullOr(Schema.String),
  badges: Schema.Array(Schema.Struct({ skill: SkillRef, level: Schema.Number })),
  /** e.g. "Your coach", "Your report" — from the viewer's perspective. */
  relation: Schema.NullOr(Schema.String),
});
export type PersonCard = typeof PersonCard.Type;

export const ProfileView = Schema.Struct({
  person: PersonSummary,
  email: Schema.String,
  businessFunction: Schema.NullOr(Schema.String),
  location: Schema.NullOr(Schema.String),
  relations: Schema.Array(Schema.String),
  badges: Schema.Array(BadgeView),
  /** Viewer is self, an active coach or in the leader chain. */
  developmentVisible: Schema.Boolean,
  progress: Schema.Array(ProgressView),
  canObserve: Schema.Boolean,
  canProposeEngagement: Schema.Boolean,
});
export type ProfileView = typeof ProfileView.Type;

export const BadgeReceiptView = Schema.Struct({
  badge: BadgeView,
  holder: PersonSummary,
  facts: Schema.String,
  narrativesVisible: Schema.Boolean,
  observations: Schema.Array(
    Schema.Struct({
      id: ObservationId,
      observer: PersonSummary,
      occurredOn: IsoDate,
      level: Schema.Number,
      levelName: Schema.String,
      mode: ObservationMode,
      narrativeSaw: Schema.NullOr(Schema.String),
    }),
  ),
});
export type BadgeReceiptView = typeof BadgeReceiptView.Type;

export const SessionView = Schema.Struct({
  person: PersonSummary,
  email: Schema.String,
  tenant: Schema.Struct({ id: Schema.String, name: Schema.String }),
  grants: Schema.Array(GrantRole),
  relations: Schema.Struct({
    hasReports: Schema.Boolean,
    hasCoachees: Schema.Boolean,
    isCoach: Schema.Boolean,
    canObserve: Schema.Boolean,
  }),
  authMode: Schema.Literals(['entra', 'dev']),
  /** Product switches from server config. */
  features: Schema.Struct({ designatedObservers: Schema.Boolean }),
});
export type SessionView = typeof SessionView.Type;

export const Persona = Schema.Struct({
  person: PersonSummary,
  summary: Schema.String,
});
export type Persona = typeof Persona.Type;
