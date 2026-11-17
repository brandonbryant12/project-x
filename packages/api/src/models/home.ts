import {
  EngagementId,
  EngagementLifecycle,
  IsoDate,
  ObservationId,
  PlanId,
  PlanLifecycle,
} from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary, SkillRef } from './common.ts';

export const QueueItem = Schema.Struct({
  kind: Schema.Literals([
    'sign_observation',
    'continue_draft',
    'revise_returned',
    'agree_plan',
    'confirm_review',
    'accept_engagement',
    'request_observation',
    'held_evidence',
  ]),
  id: Schema.String,
  title: Schema.String,
  detail: Schema.NullOr(Schema.String),
  person: Schema.NullOr(PersonSummary),
  relation: Schema.String,
  dueAt: Schema.NullOr(Instant),
  href: Schema.String,
  actionLabel: Schema.String,
});
export type QueueItem = typeof QueueItem.Type;

export const FeedItem = Schema.Struct({
  kind: Schema.Literals([
    'signed_about_you',
    'badge_earned',
    'badge_earned_by_supported',
    /** Closes the loop for the observer: "Maya read this". */
    'read_by_subject',
  ]),
  at: Instant,
  person: PersonSummary,
  observer: Schema.NullOr(PersonSummary),
  skill: SkillRef,
  level: Schema.Number,
  levelName: Schema.String,
  quote: Schema.NullOr(Schema.String),
  href: Schema.String,
});
export type FeedItem = typeof FeedItem.Type;

/** One person worth observing, and why. Never a ranking, never someone already waiting. */
export const ObserveSuggestion = Schema.Struct({
  person: PersonSummary,
  reason: Schema.Literals(['planned_this_week', 'longest_unobserved', 'second_observer']),
  sentence: Schema.String,
  href: Schema.String,
});

/**
 * Home has three parts: waiting on you, your plan, and recently. "Your plan"
 * leads with what to practise ("Try next time"), then one quiet progress line.
 */
export const HomeView = Schema.Struct({
  firstName: Schema.String,
  needsYou: Schema.Array(QueueItem),
  needsYouTotal: Schema.Number,
  /**
   * The viewer's latest signed "What next" (a signed or under-review observation
   * of the viewer; never a draft, never a voided one). Null when there is none.
   */
  tryNextTime: Schema.NullOr(
    Schema.Struct({
      sentence: Schema.String,
      observer: PersonSummary,
      signedAt: Instant,
      observationId: ObservationId,
    }),
  ),
  /** The progress line: the next badge's sentence for the first focus skill with an unmet criterion. */
  nextStep: Schema.NullOr(Schema.Struct({ skill: SkillRef, sentence: Schema.String })),
  recently: Schema.Array(FeedItem),
  plan: Schema.NullOr(
    Schema.Struct({
      id: PlanId,
      title: Schema.String,
      status: PlanLifecycle.Status,
      periodEnd: IsoDate,
      focusSkills: Schema.Array(SkillRef),
      activityCount: Schema.Number,
      observedCount: Schema.Number,
    }),
  ),
  coaches: Schema.Array(PersonSummary),
  leader: Schema.NullOr(PersonSummary),
  /** Observers: people worth observing this week, at most three. Part of "Waiting on you". */
  toObserve: Schema.Array(ObserveSuggestion),
  /** Program owners: the adoption view's first two numbers (ADR 0021). Null for everyone else. */
  programHealth: Schema.NullOr(
    Schema.Struct({
      /** Null (withheld) under the minimum cell size, as on the adoption view. */
      withPlan: Schema.NullOr(Schema.Number),
      /** Null (withheld) under the minimum cell size, as on the adoption view. */
      observedRecently: Schema.NullOr(Schema.Number),
      minimumCell: Schema.Number,
    }),
  ),
});
export type HomeView = typeof HomeView.Type;

export const CoverageDot = Schema.Struct({
  skill: SkillRef,
  observedRecently: Schema.Boolean,
  lastObservedOn: Schema.NullOr(IsoDate),
  lastObserver: Schema.NullOr(Schema.String),
});

export const SupportRow = Schema.Struct({
  person: PersonSummary,
  plan: Schema.NullOr(
    Schema.Struct({
      id: PlanId,
      status: PlanLifecycle.Status,
      focusSkills: Schema.Array(SkillRef),
    }),
  ),
  waitingOnYou: Schema.Number,
  lastObservedOn: Schema.NullOr(IsoDate),
  coverage: Schema.Array(CoverageDot),
});
export type SupportRow = typeof SupportRow.Type;

export const TeamView = Schema.Struct({
  rows: Schema.Array(SupportRow),
  waitingOnYou: Schema.Number,
  unobservedCount: Schema.Number,
});
export type TeamView = typeof TeamView.Type;

export const EngagementEventType = Schema.Literals(EngagementLifecycle.events);

export const EngagementView = Schema.Struct({
  id: EngagementId,
  status: EngagementLifecycle.Status,
  coach: PersonSummary,
  coachee: PersonSummary,
  proposedBy: PersonSummary,
  note: Schema.NullOr(Schema.String),
  acceptedOn: Schema.NullOr(IsoDate),
  expiresAt: Schema.NullOr(Instant),
  actions: Schema.Array(EngagementEventType),
  row: Schema.NullOr(SupportRow),
});
export type EngagementView = typeof EngagementView.Type;

export const CoachingView = Schema.Struct({
  asCoach: Schema.Array(EngagementView),
  asCoachee: Schema.Array(EngagementView),
  isCoach: Schema.Boolean,
});
export type CoachingView = typeof CoachingView.Type;
