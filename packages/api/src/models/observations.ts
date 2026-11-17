import {
  AdvisoryCheckId,
  AdvisoryCheckLifecycle,
  EvidenceLifecycle,
  InteractionId,
  InteractionKind,
  IsoDate,
  Level,
  ObservationId,
  ObservationLifecycle,
  ObservationMode,
  ObserverBasis,
  PersonId,
  QuestionSetId,
  SkillId,
  SkillIndicatorId,
  SkillLevelDefinition,
  SkillVersionId,
  ActivityId,
  BadgeAwardId,
  CreditRole,
  MAX_SKILLS_CEILING,
  POINTS_SOURCES,
  SkillRole,
} from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary, SkillRef } from './common.ts';

export const ObservationEventType = Schema.Literals(ObservationLifecycle.events);
export type ObservationEventType = typeof ObservationEventType.Type;

/** One assistant check, already interpreted. Never contains provider bodies. */
export const AdvisoryView = Schema.Struct({
  id: AdvisoryCheckId,
  questionSet: QuestionSetId,
  status: AdvisoryCheckLifecycle.Status,
  effect: Schema.NullOr(Schema.Literals(['hold', 'escalate', 'nudge', 'none'])),
  /** Short, hedged findings: "Evidence appears to address 3 indicators". */
  findings: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      label: Schema.String,
      outcome: Schema.Literals(['yes', 'no', 'unclear']),
    }),
  ),
  provider: Schema.String,
});
export type AdvisoryView = typeof AdvisoryView.Type;

export const RatingView = Schema.Struct({
  skill: SkillRef,
  skillVersionId: SkillVersionId,
  levels: Schema.Array(SkillLevelDefinition),
  level: Schema.NullOr(Level),
  indicatorIds: Schema.Array(SkillIndicatorId),
  credit: Schema.Boolean,
  /**
   * The skill's place in this work; decides what its credit is worth.
   * `unclassified` only on ratings signed before roles existed.
   */
  role: CreditRole,
  /**
   * True only for the observer of unsigned work: the observer owns the roles
   * (the work's roles are defaults) and may mark at most one skill primary.
   */
  roleChoosable: Schema.Boolean,
  /**
   * What a credit for this skill would add if signed now, in each role, resolved
   * as signing resolves it. Only for the observer of unsigned work; else null.
   */
  values: Schema.NullOr(Schema.Struct({ primary: Schema.Number, secondary: Schema.Number })),
});
export type RatingView = typeof RatingView.Type;

export const PointsSource = Schema.Literals(POINTS_SOURCES);
export type PointsSource = typeof PointsSource.Type;

export const ObservationView = Schema.Struct({
  id: ObservationId,
  status: ObservationLifecycle.Status,
  mode: ObservationMode,
  basis: ObserverBasis,
  subject: PersonSummary,
  observer: PersonSummary,
  requestedBy: PersonSummary,
  viewerRole: Schema.Literals(['observer', 'subject', 'viewer']),
  interaction: Schema.Struct({
    id: InteractionId,
    occurredOn: IsoDate,
    kind: InteractionKind,
    activityTitle: Schema.String,
    clientRef: Schema.NullOr(Schema.String),
  }),
  evidence: Schema.NullOr(
    Schema.Struct({
      status: EvidenceLifecycle.Status,
      body: Schema.NullOr(Schema.String),
      holdReason: Schema.NullOr(Schema.String),
    }),
  ),
  requestNote: Schema.NullOr(Schema.String),
  requestedSkills: Schema.Array(SkillRef),
  ratings: Schema.Array(RatingView),
  narrativeSaw: Schema.String,
  narrativeNext: Schema.String,
  returnNote: Schema.NullOr(Schema.String),
  declineReason: Schema.NullOr(Schema.String),
  dueAt: Instant,
  signedAt: Schema.NullOr(Instant),
  acknowledgedAt: Schema.NullOr(Instant),
  reviewNote: Schema.NullOr(Schema.String),
  /** False when the viewer is in the wider leader chain: levels only (red-team). */
  narrativeVisible: Schema.Boolean,
  updatedAt: Instant,
  version: Schema.Number,
  credits: Schema.Array(
    Schema.Struct({
      skill: SkillRef,
      level: Schema.Number,
      levelName: Schema.String,
      firstHand: Schema.Boolean,
      /** Frozen at signing. */
      points: Schema.Number,
      /** `unclassified`: observed before roles existed (label it so). */
      role: CreditRole,
      /** Where the points came from (`legacy` for credits signed before points). */
      pointsSource: PointsSource,
    }),
  ),
  badgesEarned: Schema.Array(
    Schema.Struct({
      id: BadgeAwardId,
      skill: SkillRef,
      level: Schema.Number,
      levelName: Schema.String,
    }),
  ),
  earlier: Schema.Array(
    Schema.Struct({
      id: ObservationId,
      observer: PersonSummary,
      occurredOn: IsoDate,
      skill: SkillRef,
      level: Schema.Number,
    }),
  ),
  advisory: Schema.Array(AdvisoryView),
  actions: Schema.Array(ObservationEventType),
  /** The viewer wrote the reflection and may revise it here (a request sent back to them). */
  canReviseEvidence: Schema.Boolean,
  /** The tenant's limit on rated skills, for the observer of unsigned work; else null. */
  maxSkills: Schema.NullOr(Schema.Number),
});
export type ObservationView = typeof ObservationView.Type;

export const InboxItem = Schema.Struct({
  id: ObservationId,
  status: ObservationLifecycle.Status,
  subject: PersonSummary,
  observer: PersonSummary,
  activityTitle: Schema.String,
  occurredOn: IsoDate,
  skills: Schema.Array(SkillRef),
  evidencePreview: Schema.NullOr(Schema.String),
  indicatorsTicked: Schema.Number,
  dueAt: Instant,
  updatedAt: Instant,
});
export type InboxItem = typeof InboxItem.Type;

export const InboxView = Schema.Struct({
  requests: Schema.Array(InboxItem),
  drafts: Schema.Array(InboxItem),
  signed: Schema.Array(InboxItem),
  /** Observations I asked for that are waiting on someone (or returned to me). */
  mine: Schema.Array(InboxItem),
});
export type InboxView = typeof InboxView.Type;

/** The hard ceiling; the tenant's credit policy sets the working limit, checked by the server. */
const SkillIds = Schema.Array(SkillId).pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SKILLS_CEILING)),
);

export const RequestObservationInput = Schema.Struct({
  interactionId: InteractionId,
  observerId: PersonId,
  mode: ObservationMode,
  skillIds: SkillIds,
  note: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(280)))),
});
export type RequestObservationInput = typeof RequestObservationInput.Type;

/**
 * "I saw this": observer-initiated. Creates the interaction and a draft, or,
 * with `interactionId`, attaches the draft to work the subject already logged
 * (its date and kind then come from that work), so one piece of work is never
 * recorded twice.
 */
export const StartObservationInput = Schema.Struct({
  subjectId: PersonId,
  interactionId: Schema.optional(Schema.NullOr(InteractionId)),
  activityId: Schema.NullOr(ActivityId),
  title: Schema.NullOr(Schema.String),
  occurredOn: IsoDate,
  kind: InteractionKind,
  mode: ObservationMode,
  skillIds: SkillIds,
});
export type StartObservationInput = typeof StartObservationInput.Type;

export const RatingInput = Schema.Struct({
  skillId: SkillId,
  level: Schema.NullOr(Level),
  indicatorIds: Schema.Array(SkillIndicatorId),
  credit: Schema.Boolean,
  /**
   * The observer's choice of role (the observer owns the roles; at most one
   * primary). Omitted: the role stored on the rating, else the work's default.
   */
  role: Schema.optional(SkillRole),
});
export type RatingInput = typeof RatingInput.Type;

export const ObservationDraftInput = Schema.Struct({
  /** Optimistic concurrency: the version the client last saw. */
  version: Schema.Number,
  /** How the OBSERVER knows (not the coachee's claim). Frozen at signing. */
  mode: ObservationMode,
  ratings: Schema.Array(RatingInput).pipe(Schema.check(Schema.isMaxLength(MAX_SKILLS_CEILING))),
  narrativeSaw: Schema.String.pipe(Schema.check(Schema.isMaxLength(4000))),
  narrativeNext: Schema.String.pipe(Schema.check(Schema.isMaxLength(4000))),
});
export type ObservationDraftInput = typeof ObservationDraftInput.Type;

export const ObservationTransitionInput = Schema.Struct({
  event: Schema.Literals([
    'START',
    'RETURN',
    'DECLINE',
    'WITHDRAW',
    'RESUBMIT',
    'ACKNOWLEDGE',
    'REQUEST_REVIEW',
    'UPHOLD',
    'VOID',
  ]),
  note: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(600)))),
});
export type ObservationTransitionInput = typeof ObservationTransitionInput.Type;

/** A skill of a piece of work with its default role for observations of it. */
export const WorkSkill = Schema.Struct({ skill: SkillRef, role: SkillRole });
export type WorkSkill = typeof WorkSkill.Type;

export const ObserveTarget = Schema.Struct({
  person: PersonSummary,
  basis: ObserverBasis,
  activities: Schema.Array(
    Schema.Struct({ id: ActivityId, title: Schema.String, skills: Schema.Array(WorkSkill) }),
  ),
  /**
   * Work this person already logged inside the "I saw this" window that the
   * viewer has not observed: "I saw this" attaches to it instead of recording
   * the same work twice. Title and kind only, never the reflection.
   */
  work: Schema.Array(
    Schema.Struct({
      id: InteractionId,
      occurredOn: IsoDate,
      kind: InteractionKind,
      title: Schema.String,
      activityId: ActivityId,
      skills: Schema.Array(WorkSkill),
    }),
  ),
  focusSkills: Schema.Array(SkillRef),
});
export type ObserveTarget = typeof ObserveTarget.Type;

/** Who the viewer can observe today, and the tenant's limit on rated skills. */
export const ObserveTargets = Schema.Struct({
  people: Schema.Array(ObserveTarget),
  maxSkills: Schema.Number,
});
export type ObserveTargets = typeof ObserveTargets.Type;
