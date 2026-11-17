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
  MAX_SKILLS_CEILING,
  ObservationId,
  ObservationMode,
  PersonId,
  ObservationLifecycle,
  ObserverBasis,
  PLAN_OUTCOMES,
  PlanId,
  PlanLifecycle,
  SkillId,
  SkillRole,
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
  /** The viewer wrote the reflection and may revise it (offered while it is held). */
  canReviseEvidence: Schema.Boolean,
});
export type InteractionSummary = typeof InteractionSummary.Type;

export const PlanOutcome = Schema.Literals(PLAN_OUTCOMES);
export type PlanOutcome = typeof PlanOutcome.Type;

/** What a resolved value is and where it came from (the domain resolver, as signing uses it). */
export const ResolvedValue = Schema.Struct({
  points: Schema.Number,
  /** Never `legacy`: that marks only credits signed before points existed. */
  source: Schema.Literals(['activity', 'template', 'skill', 'tenant']),
});

/** One skill of a piece of work: its role, and what a signed observation would add right now. */
export const ActivitySkillView = Schema.Struct({
  skill: SkillRef,
  /** The default role for observations of this work; the observer decides when signing. */
  role: SkillRole,
  /** What one signed observation of this skill in this role would add today. */
  value: ResolvedValue,
  /** The activity's own value, with who set it; null when there is none. */
  override: Schema.NullOr(Schema.Struct({ points: Schema.Number, setBy: PersonSummary })),
  /** The value the skill would get without the activity's own value. */
  valueWithoutOverride: ResolvedValue,
});
export type ActivitySkillView = typeof ActivitySkillView.Type;

export const ActivityView = Schema.Struct({
  id: ActivityId,
  title: Schema.String,
  description: Schema.String,
  status: ActivityLifecycle.Status,
  origin: ActivityOrigin,
  dueOn: Schema.NullOr(IsoDate),
  template: Schema.NullOr(Schema.Struct({ id: ActivityTemplateId, name: Schema.String })),
  /** In order; at most one is primary. */
  skills: Schema.Array(ActivitySkillView),
  intendedObserver: Schema.NullOr(PersonSummary),
  intendedMode: Schema.NullOr(ObservationMode),
  interactions: Schema.Array(InteractionSummary),
  /** Lifecycle events the viewer may send (LOG_INTERACTION means "may log work here"). */
  actions: Schema.Array(ActivityEventType),
  /** The viewer may change the title, description, due date, commitment and skills. */
  canEdit: Schema.Boolean,
  /** The viewer may set or clear an individual value for a skill of this work. */
  canSetValue: Schema.Boolean,
});
export type ActivityView = typeof ActivityView.Type;

export const FocusSkillView = Schema.Struct({
  skill: SkillRef,
  /** 1 to 4. A target is reviewed by a person when the plan closes; badges exist for 2 and 3. */
  targetLevel: Schema.Number,
  targetLevelName: Schema.String,
  /** A badge can be earned at the target level (2 or 3). */
  targetHasBadge: Schema.Boolean,
  /** The highest level a signed, unreversed observation has seen in this skill. */
  highestObservedLevel: Schema.NullOr(Schema.Number),
  /** Distinct pieces of work observed at or above the target level. */
  observedAtTarget: Schema.Number,
  /** Set in the closing review. */
  outcome: Schema.NullOr(PlanOutcome),
});
export type FocusSkillView = typeof FocusSkillView.Type;

export const PlanReviewView = Schema.Struct({
  recordedBy: PersonSummary,
  recordedAt: Instant,
  confirmedBy: Schema.NullOr(PersonSummary),
  confirmedAt: Schema.NullOr(Instant),
});

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
  focusSkills: Schema.Array(FocusSkillView),
  agreedBy: Schema.NullOr(PersonSummary),
  agreedAt: Schema.NullOr(Instant),
  endorsedBy: Schema.NullOr(PersonSummary),
  closingSummary: Schema.NullOr(Schema.String),
  /** The closing review, once recorded: outcomes are on `focusSkills`. */
  review: Schema.NullOr(PlanReviewView),
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
  /** Lifecycle events the viewer may send. */
  actions: Schema.Array(PlanEventType),
  /** The viewer may change the title, intent and end date. */
  canEdit: Schema.Boolean,
  /** The viewer may change the focus skills and target levels (drafts only). */
  canEditFocusSkills: Schema.Boolean,
  /** The viewer may add work to the plan. */
  canAddWork: Schema.Boolean,
  canRecordReview: Schema.Boolean,
  canConfirmReview: Schema.Boolean,
  /** The range an individual value must lie in; null when the tenant does not allow them. */
  valueRange: Schema.NullOr(Schema.Struct({ min: Schema.Number, max: Schema.Number })),
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
      focusSkills: Schema.Array(FocusSkillView),
      closingSummary: Schema.NullOr(Schema.String),
      review: Schema.NullOr(PlanReviewView),
      canRecordReview: Schema.Boolean,
      canConfirmReview: Schema.Boolean,
    }),
  ),
  /** Progress for skills with credit outside the current plan's focus. */
  otherProgress: Schema.Array(ProgressView),
});
export type DevelopmentView = typeof DevelopmentView.Type;

const Title = Schema.String.pipe(Schema.check(Schema.isMinLength(3), Schema.isMaxLength(120)));
const Description = Schema.String.pipe(Schema.check(Schema.isMaxLength(600)));

/**
 * A published template as planning needs it: its own skills with their roles
 * and values, which adding work copies (never re-read afterwards).
 */
export const WorkTemplate = Schema.Struct({
  id: ActivityTemplateId,
  name: Schema.String,
  description: Schema.String,
  kind: InteractionKind,
  observationTip: Schema.NullOr(Schema.String),
  skills: Schema.Array(
    Schema.Struct({ skill: SkillRef, role: SkillRole, points: Schema.NullOr(Schema.Number) }),
  ),
});
export type WorkTemplate = typeof WorkTemplate.Type;

/** A skill of a piece of work with its role; at most one primary (checked on the server). */
export const ActivitySkillInput = Schema.Struct({ skillId: SkillId, role: SkillRole });
const ActivitySkills = Schema.Array(ActivitySkillInput).pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SKILLS_CEILING)),
);

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
});
export type UpdatePlanInput = typeof UpdatePlanInput.Type;

/** The closing review: one outcome per focus skill, and the summary. */
export const RecordPlanReviewInput = Schema.Struct({
  outcomes: Schema.Array(Schema.Struct({ skillId: SkillId, outcome: PlanOutcome })).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  ),
  summary: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2000))),
});
export type RecordPlanReviewInput = typeof RecordPlanReviewInput.Type;

export const AddActivityInput = Schema.Struct({
  /** A published template; its roles and values are copied for its own skills. */
  templateId: Schema.NullOr(ActivityTemplateId),
  title: Title,
  description: Description,
  skills: ActivitySkills,
  dueOn: Schema.NullOr(IsoDate),
  /** The observation commitment: who will see this, and how. */
  intendedObserverId: Schema.NullOr(PersonId),
  intendedMode: Schema.NullOr(ObservationMode),
});
export type AddActivityInput = typeof AddActivityInput.Type;

/** Replaces the editable fields of a piece of work; skills are diffed, not re-created. */
export const UpdateActivityInput = Schema.Struct({
  title: Title,
  description: Description,
  skills: ActivitySkills,
  dueOn: Schema.NullOr(IsoDate),
  intendedObserverId: Schema.NullOr(PersonId),
  intendedMode: Schema.NullOr(ObservationMode),
});
export type UpdateActivityInput = typeof UpdateActivityInput.Type;

/** Sets (or, with null, clears) one skill's individual value on a piece of work. */
export const SetActivityValueInput = Schema.Struct({
  skillId: SkillId,
  points: Schema.NullOr(Schema.Int),
  reason: Schema.String.pipe(Schema.check(Schema.isMinLength(10), Schema.isMaxLength(600))),
});
export type SetActivityValueInput = typeof SetActivityValueInput.Type;

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
