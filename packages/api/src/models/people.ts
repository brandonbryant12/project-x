import {
  BadgeAwardId,
  COACHING_DIRECTIONS,
  CreditRole,
  GrantRole,
  InteractionId,
  IsoDate,
  ObservationId,
  ObservationMode,
} from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary, ProgressView, SkillRef } from './common.ts';
import { PointsSource } from './observations.ts';

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
  /**
   * The coaching proposals the viewer may make with this person, from the
   * viewer's side: `coach_them` (the viewer coaches) and `coach_me` (this person
   * coaches the viewer). Empty when neither is possible (`proposableDirections`).
   */
  coachingDirections: Schema.Array(Schema.Literals(COACHING_DIRECTIONS)),
});
export type ProfileView = typeof ProfileView.Type;

/** One observer's credit for a piece of work, as it stands on the badge's receipt. */
export const ReceiptCredit = Schema.Struct({
  /** The observation that posted it. */
  id: ObservationId,
  observer: PersonSummary,
  level: Schema.Number,
  levelName: Schema.String,
  mode: ObservationMode,
  /** Null where the viewer may not read the observer's words (I13). */
  narrativeSaw: Schema.NullOr(Schema.String),
  /** What this credit was worth, frozen at signing. */
  points: Schema.Number,
  /** `unclassified`: observed before roles existed. */
  role: CreditRole,
  /** Where the value came from: `activity` is an individual value set on that work; `legacy` before points. */
  pointsSource: PointsSource,
  /** True for the one credit that counted for its piece of work; the others are the same work. */
  counted: Schema.Boolean,
  /** Reversed after the award (its observation was voided): shown, never counted. */
  reversed: Schema.Boolean,
});
export type ReceiptCredit = typeof ReceiptCredit.Type;

/**
 * "How this was earned". The badge is visible tenant-wide; the points, the
 * thresholds and the per-credit detail are development data, returned only to
 * the holder, their coaches and their leader chain (`detailVisible`).
 */
export const BadgeReceiptView = Schema.Struct({
  badge: BadgeView,
  holder: PersonSummary,
  facts: Schema.String,
  narrativesVisible: Schema.Boolean,
  /** The viewer may see the holder's development: points, thresholds and each credit. */
  detailVisible: Schema.Boolean,
  /**
   * Points that count now: each piece of work once, at its highest value, credit
   * reversed since the award left out. Null without `detailVisible`.
   */
  points: Schema.NullOr(Schema.Number),
  /** What the badge needed when it was awarded (its saved thresholds); null if unreadable or not visible. */
  required: Schema.NullOr(
    Schema.Struct({
      points: Schema.Number,
      interactions: Schema.Number,
      observers: Schema.Number,
      firstHandShare: Schema.Number,
      spanDays: Schema.Number,
      /** 0: no requirement. */
      primaryPoints: Schema.Number,
    }),
  ),
  /**
   * Each piece of work in date order, with every credit for it; at most one
   * counted (none when all its credits were reversed). Empty without `detailVisible`.
   */
  work: Schema.Array(
    Schema.Struct({
      interactionId: InteractionId,
      occurredOn: IsoDate,
      points: Schema.Number,
      credits: Schema.Array(ReceiptCredit),
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
