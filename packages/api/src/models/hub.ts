import {
  DesignationId,
  IsoDate,
  NotificationChannel,
  NotificationKind,
  PersonId,
} from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary } from './common.ts';

/* ---------- Home: Today and This week (path-to-A § 2) ---------- */

export const TodayItem = Schema.Struct({
  kind: Schema.Literals(['planned_observation', 'activity_due']),
  id: Schema.String,
  title: Schema.String,
  person: Schema.NullOr(PersonSummary),
  on: IsoDate,
  href: Schema.String,
});
export type TodayItem = typeof TodayItem.Type;

/** One person worth observing this week, and why. Never a ranking. */
export const ObserveSuggestion = Schema.Struct({
  person: PersonSummary,
  reason: Schema.Literals([
    'request_closing',
    'planned_this_week',
    'longest_unobserved',
    'second_observer',
  ]),
  sentence: Schema.String,
  href: Schema.String,
});
export type ObserveSuggestion = typeof ObserveSuggestion.Type;

export const ThisWeek = Schema.Struct({
  /** Monday of the current business week (tenant time zone). */
  weekOf: IsoDate,
  toObserve: Schema.Array(ObserveSuggestion),
  /** Leaders: "4 of your 9 reports were observed in the last six weeks." */
  coverageSentence: Schema.NullOr(Schema.String),
  /** The viewer's self-set capacity. */
  observeCapacity: Schema.Number,
});
export type ThisWeek = typeof ThisWeek.Type;

/* ---------- Designated observers (ADR 0020) ---------- */

export const DesignationView = Schema.Struct({
  id: DesignationId,
  subject: PersonSummary,
  observer: PersonSummary,
  designatedBy: PersonSummary,
  validFrom: IsoDate,
  /** The effective end (an early end if there was one). */
  validTo: IsoDate,
  active: Schema.Boolean,
  canEnd: Schema.Boolean,
});
export type DesignationView = typeof DesignationView.Type;

export const DesignateInput = Schema.Struct({
  subjectId: PersonId,
  observerId: PersonId,
  validFrom: IsoDate,
  validTo: IsoDate,
});

/* ---------- Notifications (ADR 0018) ---------- */

export const NotificationPreferences = Schema.Struct({
  channel: NotificationChannel,
  weeklyDigest: Schema.Boolean,
  observeCapacity: Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 }))),
});
export type NotificationPreferences = typeof NotificationPreferences.Type;

/** The outbox as an admin sees it: there is no content to show (I20). */
export const OutboxRow = Schema.Struct({
  kind: NotificationKind,
  recipient: PersonSummary,
  status: Schema.Literals(['pending', 'sent', 'skipped', 'failed']),
  channel: Schema.NullOr(Schema.String),
  /** The exact message as rendered from the template. */
  rendered: Schema.Struct({
    subject: Schema.String,
    lines: Schema.Array(Schema.String),
    link: Schema.String,
  }),
  createdAt: Instant,
  sentAt: Schema.NullOr(Instant),
});
export type OutboxRow = typeof OutboxRow.Type;

/* ---------- Adoption (ADR 0021): aggregates only, no names ---------- */

export const AdoptionWeek = Schema.Struct({
  weekOf: IsoDate,
  signed: Schema.Number,
  /** Null when fewer than five values (minimum cell size). */
  medianDaysToSign: Schema.NullOr(Schema.Number),
  p90DaysToSign: Schema.NullOr(Schema.Number),
  requested: Schema.Number,
  /** Null until the cohort's signing window has closed, or when fewer than five were requested. */
  expiryRate: Schema.NullOr(Schema.Number),
  /** Null when fewer than five (minimum cell size). */
  activeObservers: Schema.NullOr(Schema.Number),
});

export const AdoptionView = Schema.Struct({
  asOf: IsoDate,
  minimumCell: Schema.Number,
  weeks: Schema.Array(AdoptionWeek),
  /** People with a current plan observed in the last 42 days / people with a current plan. */
  coverage: Schema.Struct({ observed: Schema.NullOr(Schema.Number), withPlan: Schema.Number }),
  expiryRate: Schema.NullOr(Schema.Number),
  firstHandShare: Schema.NullOr(Schema.Number),
  feedbackOnlyShare: Schema.NullOr(Schema.Number),
  acknowledgedShare: Schema.NullOr(Schema.Number),
  reviewRequestedShare: Schema.NullOr(Schema.Number),
  /** Distribution: how many people have 0, 1, 2, 3+ distinct observers. */
  /** Buckets under five people are null (shown as "fewer than 5"). */
  distinctObservers: Schema.Array(
    Schema.Struct({ bucket: Schema.String, people: Schema.NullOr(Schema.Number) }),
  ),
  /** Histogram of signatures per observer in the last 28 days; never names. */
  observerLoad: Schema.Array(
    Schema.Struct({ bucket: Schema.String, observers: Schema.NullOr(Schema.Number) }),
  ),
  /** Share of sent notifications followed by the intended action within 7 days. */
  notificationConversion: Schema.NullOr(Schema.Number),
});
export type AdoptionView = typeof AdoptionView.Type;
