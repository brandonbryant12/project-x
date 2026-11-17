import {
  CommitmentId,
  CommitmentLifecycle,
  ConversationBasis,
  ConversationId,
  ConversationLifecycle,
  DesignationId,
  InteractionId,
  InteractionKind,
  IsoDate,
  NotificationChannel,
  NotificationKind,
  ObservationId,
  PersonId,
} from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary, SkillRef } from './common.ts';

export const CommitmentView = Schema.Struct({
  id: CommitmentId,
  owner: PersonSummary,
  createdBy: PersonSummary,
  /** Empty once purged. Visible to the owner, the creator, and the owner's coaches and leader. */
  body: Schema.String,
  dueOn: Schema.NullOr(IsoDate),
  status: CommitmentLifecycle.Status,
  sourceObservationId: Schema.NullOr(ObservationId),
  conversationId: Schema.NullOr(ConversationId),
  createdAt: Instant,
  actions: Schema.Array(Schema.Literals(CommitmentLifecycle.events)),
});
export type CommitmentView = typeof CommitmentView.Type;

/* ---------- Conversations (ADR 0019) ---------- */

export const ConversationSummary = Schema.Struct({
  id: ConversationId,
  status: ConversationLifecycle.Status,
  basis: ConversationBasis,
  host: PersonSummary,
  coachee: PersonSummary,
  scheduledFor: Instant,
  heldOn: Schema.NullOr(IsoDate),
  openCommitments: Schema.Number,
  href: Schema.String,
});
export type ConversationSummary = typeof ConversationSummary.Type;

/** Assembled, never stored: what to talk about. */
export const ConversationAgenda = Schema.Struct({
  /** Since the previous held conversation between the same two people. */
  since: Schema.NullOr(IsoDate),
  signedObservations: Schema.Array(
    Schema.Struct({
      id: ObservationId,
      observer: PersonSummary,
      occurredOn: IsoDate,
      skills: Schema.Array(SkillRef),
      href: Schema.String,
    }),
  ),
  unobservedInteractions: Schema.Array(
    Schema.Struct({
      id: InteractionId,
      occurredOn: IsoDate,
      kind: InteractionKind,
      title: Schema.String,
    }),
  ),
  commitments: Schema.Array(CommitmentView),
  nextStep: Schema.NullOr(Schema.Struct({ skill: SkillRef, sentence: Schema.String })),
});

export const ConversationView = Schema.Struct({
  ...ConversationSummary.fields,
  agenda: ConversationAgenda,
  actions: Schema.Array(Schema.Literals(ConversationLifecycle.events)),
  version: Schema.Number,
});
export type ConversationView = typeof ConversationView.Type;

export const ConversationsView = Schema.Struct({
  upcoming: Schema.Array(ConversationSummary),
  recent: Schema.Array(ConversationSummary),
  /** People the viewer can schedule with: their coachees, reports, coaches and leader. */
  partners: Schema.Array(
    Schema.Struct({ person: PersonSummary, basis: ConversationBasis, asHost: Schema.Boolean }),
  ),
});
export type ConversationsView = typeof ConversationsView.Type;

export const ScheduleConversationInput = Schema.Struct({
  /** The other party. The server works out who hosts and on which basis. */
  withPersonId: PersonId,
  scheduledFor: Instant,
});

export const ConversationEventInput = Schema.Struct({
  event: Schema.Literals(ConversationLifecycle.events),
  version: Schema.Number,
  /** RESCHEDULE only. */
  scheduledFor: Schema.optional(Instant),
});

export const CreateCommitmentInput = Schema.Struct({
  ownerId: PersonId,
  body: Schema.String.pipe(Schema.check(Schema.isMinLength(3), Schema.isMaxLength(280))),
  dueOn: Schema.NullOr(IsoDate),
  conversationId: Schema.NullOr(ConversationId),
  sourceObservationId: Schema.NullOr(ObservationId),
});

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
