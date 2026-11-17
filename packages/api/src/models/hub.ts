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

/** Two switches: email when something waits on you, and the Monday digest. */
export const NotificationPreferences = Schema.Struct({
  sendEmail: Schema.Boolean,
  weeklyDigest: Schema.Boolean,
});
export type NotificationPreferences = typeof NotificationPreferences.Type;

/* ---------- Adoption (ADR 0021): four numbers, aggregates only, no names ---------- */

/** Every nullable figure is null when drawn from fewer than `minimumCell` (shown as "fewer than 5"). */
export const AdoptionView = Schema.Struct({
  asOf: IsoDate,
  minimumCell: Schema.Number,
  /** People with an active or paused plan. */
  withPlan: Schema.Number,
  /** Of those, people observed for work in the last six weeks. */
  observedRecently: Schema.NullOr(Schema.Number),
  /** Over the last four complete weeks: days from logging the work to the signature. */
  medianDaysToSign: Schema.NullOr(Schema.Number),
  /** Over the last four weeks: share of requests whose window closed without a signature. */
  expiryRate: Schema.NullOr(Schema.Number),
});
export type AdoptionView = typeof AdoptionView.Type;
