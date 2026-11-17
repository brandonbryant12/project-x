import { EngagementId, EngagementLifecycle, IsoDate, PlanId, PlanLifecycle } from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary, SkillRef } from './common.ts';
import { CommitmentView, ConversationSummary, ThisWeek, TodayItem } from './hub.ts';

export const QueueItem = Schema.Struct({
  kind: Schema.Literals([
    'sign_observation',
    'continue_draft',
    'revise_returned',
    'agree_plan',
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

export const HomeView = Schema.Struct({
  firstName: Schema.String,
  needsYou: Schema.Array(QueueItem),
  needsYouTotal: Schema.Number,
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
  /** Path-to-A § 2: the daily brief. */
  today: Schema.Array(TodayItem),
  thisWeek: ThisWeek,
  /** The viewer's own open commitments (as coachee). */
  myCommitments: Schema.Array(CommitmentView),
  nextConversation: Schema.NullOr(ConversationSummary),
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
