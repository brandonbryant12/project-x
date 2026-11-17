import {
  ActivityId,
  ActivityLifecycle,
  ActivityOrigin,
  ActivityTemplateId,
  EvidenceLifecycle,
  InteractionId,
  InteractionKind,
  IsoDate,
  Level,
  ObservationId,
  ObservationMode,
  PersonId,
  ObservationLifecycle,
  ObserverBasis,
  PlanId,
  PlanLifecycle,
  SkillId,
} from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary, ProgressView, SkillRef } from './common.ts';

export const PlanEventType = Schema.Literals(PlanLifecycle.events);
export const ActivityEventType = Schema.Literals(ActivityLifecycle.events);

export const InteractionSummary = Schema.Struct({
  id: InteractionId,
  occurredOn: IsoDate,
  kind: InteractionKind,
  evidenceStatus: Schema.NullOr(EvidenceLifecycle.Status),
  observations: Schema.Array(
    Schema.Struct({
      id: ObservationId,
      status: ObservationLifecycle.Status,
      observer: PersonSummary,
    }),
  ),
  /** Owner may request an observation (no open or signed one from every eligible observer). */
  canRequestObservation: Schema.Boolean,
});
export type InteractionSummary = typeof InteractionSummary.Type;

export const ActivityView = Schema.Struct({
  id: ActivityId,
  title: Schema.String,
  description: Schema.String,
  status: ActivityLifecycle.Status,
  origin: ActivityOrigin,
  dueOn: Schema.NullOr(IsoDate),
  template: Schema.NullOr(Schema.Struct({ id: ActivityTemplateId, name: Schema.String })),
  targetSkills: Schema.Array(SkillRef),
  intendedObserver: Schema.NullOr(PersonSummary),
  intendedMode: Schema.NullOr(ObservationMode),
  interactions: Schema.Array(InteractionSummary),
  actions: Schema.Array(ActivityEventType),
});
export type ActivityView = typeof ActivityView.Type;

export const PlanView = Schema.Struct({
  id: PlanId,
  title: Schema.String,
  intent: Schema.String,
  status: PlanLifecycle.Status,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  owner: PersonSummary,
  coach: Schema.NullOr(PersonSummary),
  leader: Schema.NullOr(PersonSummary),
  focusSkills: Schema.Array(
    Schema.Struct({
      skill: SkillRef,
      targetLevel: Schema.Number,
      targetLevelName: Schema.String,
      outcome: Schema.NullOr(Schema.String),
    }),
  ),
  agreedBy: Schema.NullOr(PersonSummary),
  agreedAt: Schema.NullOr(Instant),
  endorsedBy: Schema.NullOr(PersonSummary),
  closingSummary: Schema.NullOr(Schema.String),
  /** The latest signed observation's "What next", when the viewer may read narratives (I13). */
  tryNextTime: Schema.NullOr(
    Schema.Struct({
      sentence: Schema.String,
      observer: PersonSummary,
      signedAt: Instant,
      observationId: ObservationId,
    }),
  ),
  activities: Schema.Array(ActivityView),
  progress: Schema.Array(ProgressView),
  actions: Schema.Array(PlanEventType),
});
export type PlanView = typeof PlanView.Type;

export const DevelopmentView = Schema.Struct({
  person: PersonSummary,
  plan: Schema.NullOr(PlanView),
  pastPlans: Schema.Array(
    Schema.Struct({
      id: PlanId,
      title: Schema.String,
      status: PlanLifecycle.Status,
      periodEnd: IsoDate,
    }),
  ),
  /** Progress for skills with credit outside the current plan's focus. */
  otherProgress: Schema.Array(ProgressView),
});
export type DevelopmentView = typeof DevelopmentView.Type;

const Title = Schema.String.pipe(Schema.check(Schema.isMinLength(3), Schema.isMaxLength(120)));
const SkillIds = (max: number) =>
  Schema.Array(SkillId).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(max)));

export const FocusSkillInput = Schema.Struct({ skillId: SkillId, targetLevel: Level });

export const CreatePlanInput = Schema.Struct({
  title: Title,
  intent: Schema.String.pipe(Schema.check(Schema.isMaxLength(600))),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  focusSkills: Schema.Array(FocusSkillInput).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  ),
});
export type CreatePlanInput = typeof CreatePlanInput.Type;

export const UpdatePlanInput = Schema.Struct({
  title: Schema.optional(Title),
  intent: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(600)))),
  focusSkills: Schema.optional(
    Schema.Array(FocusSkillInput).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(3))),
  ),
  periodEnd: Schema.optional(IsoDate),
  closingSummary: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(2000)))),
});
export type UpdatePlanInput = typeof UpdatePlanInput.Type;

export const AddActivityInput = Schema.Struct({
  templateId: Schema.NullOr(ActivityTemplateId),
  title: Title,
  description: Schema.String.pipe(Schema.check(Schema.isMaxLength(600))),
  targetSkillIds: SkillIds(3),
  dueOn: Schema.NullOr(IsoDate),
  /** The observation commitment: who will see this, and how. */
  intendedObserverId: Schema.NullOr(PersonId),
  intendedMode: Schema.NullOr(ObservationMode),
});
export type AddActivityInput = typeof AddActivityInput.Type;

/** Self-report is fine for the *event*; it never credits (domain-model.md). */
export const LogInteractionInput = Schema.Struct({
  activityId: Schema.NullOr(ActivityId),
  /** Required when `activityId` is null: creates an ad hoc activity. */
  adHocTitle: Schema.NullOr(Schema.String),
  adHocSkillIds: Schema.Array(SkillId),
  occurredOn: IsoDate,
  kind: InteractionKind,
  clientRef: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))),
  reflection: Schema.String.pipe(Schema.check(Schema.isMinLength(10), Schema.isMaxLength(4000))),
});
export type LogInteractionInput = typeof LogInteractionInput.Type;

export const InteractionView = Schema.Struct({
  id: InteractionId,
  activityId: ActivityId,
  activityTitle: Schema.String,
  occurredOn: IsoDate,
  kind: InteractionKind,
  clientRef: Schema.NullOr(Schema.String),
  owner: PersonSummary,
  evidence: Schema.NullOr(
    Schema.Struct({
      status: EvidenceLifecycle.Status,
      body: Schema.NullOr(Schema.String),
      holdReason: Schema.NullOr(Schema.String),
    }),
  ),
  eligibleObservers: Schema.Array(
    Schema.Struct({
      person: PersonSummary,
      basis: ObserverBasis,
      /** e.g. "Would count as your second observer". */
      hint: Schema.NullOr(Schema.String),
      alreadyAsked: Schema.Boolean,
    }),
  ),
});
export type InteractionView = typeof InteractionView.Type;

export const TimelineItem = Schema.Struct({
  at: Instant,
  kind: Schema.Literals([
    'interaction_logged',
    'observation_requested',
    'observation_signed',
    'badge_earned',
    'plan_agreed',
  ]),
  title: Schema.String,
  detail: Schema.NullOr(Schema.String),
  href: Schema.NullOr(Schema.String),
  person: Schema.NullOr(PersonSummary),
});
export type TimelineItem = typeof TimelineItem.Type;
