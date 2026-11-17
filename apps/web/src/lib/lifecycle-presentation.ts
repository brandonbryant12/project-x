import type {
  ActivityStatus,
  CommitmentStatus,
  ConversationStatus,
  EngagementStatus,
  EvidenceStatus,
  ObservationStatus,
  ObserverBasis,
  PlanStatus,
} from '@repo/domain';
import type { Tone } from '@repo/ui';

/**
 * One place for status words and tones (ux-brief §3 pill tables). Never red for
 * deadlines; terminal states are muted.
 */
interface Presentation {
  readonly label: string;
  readonly tone: Tone;
}

export const OBSERVATION_STATUS: Record<ObservationStatus, Presentation> = {
  requested: { label: 'Requested', tone: 'neutral' },
  drafting: { label: 'In progress', tone: 'info' },
  returned: { label: 'Returned', tone: 'warning' },
  signed: { label: 'Signed', tone: 'success' },
  under_review: { label: 'Under review', tone: 'warning' },
  declined: { label: 'Declined', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' },
  expired: { label: 'Closed', tone: 'muted' },
  voided: { label: 'Voided', tone: 'muted' },
};

export const PLAN_STATUS: Record<PlanStatus, Presentation> = {
  draft: { label: 'Draft', tone: 'neutral' },
  proposed: { label: 'Waiting for agreement', tone: 'info' },
  active: { label: 'Active', tone: 'primary' },
  paused: { label: 'Paused', tone: 'neutral' },
  completed: { label: 'Completed', tone: 'success' },
  canceled: { label: 'Canceled', tone: 'muted' },
  expired: { label: 'Closed', tone: 'muted' },
};

export const ACTIVITY_STATUS: Record<ActivityStatus, Presentation> = {
  planned: { label: 'Planned', tone: 'neutral' },
  underway: { label: 'Underway', tone: 'primary' },
  done: { label: 'Done', tone: 'success' },
  canceled: { label: 'Canceled', tone: 'muted' },
  expired: { label: 'Closed', tone: 'muted' },
};

export const ENGAGEMENT_STATUS: Record<EngagementStatus, Presentation> = {
  proposed: { label: 'Proposed', tone: 'info' },
  active: { label: 'Active', tone: 'primary' },
  paused: { label: 'Paused', tone: 'neutral' },
  ended: { label: 'Ended', tone: 'muted' },
  declined: { label: 'Declined', tone: 'muted' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' },
  expired: { label: 'Closed', tone: 'muted' },
};

export const EVIDENCE_STATUS: Record<EvidenceStatus, Presentation> = {
  screening: { label: 'Privacy check', tone: 'neutral' },
  held: { label: 'Held for privacy', tone: 'info' },
  escalated: { label: 'With compliance', tone: 'warning' },
  available: { label: 'Shared', tone: 'success' },
};

/** Button labels for lifecycle events, per entity. */
export const PLAN_EVENT_LABEL: Record<string, string> = {
  PROPOSE: 'Propose plan',
  REVISE: 'Back to draft',
  AGREE: 'Agree to plan',
  ENDORSE: 'Endorse',
  PAUSE: 'Pause',
  RESUME: 'Resume',
  COMPLETE: 'Complete plan',
  CANCEL: 'Cancel plan',
};

export const ACTIVITY_EVENT_LABEL: Record<string, string> = {
  COMPLETE: 'Mark done',
  CANCEL: 'Cancel activity',
};

export const ENGAGEMENT_EVENT_LABEL: Record<string, string> = {
  ACCEPT: 'Accept',
  DECLINE: 'Decline',
  WITHDRAW: 'Withdraw',
  PAUSE: 'Pause',
  RESUME: 'Resume',
  END: 'End engagement',
};

/** Why an observer may observe: the label beside their name (ADR 0020 adds `designated`). */
export const BASIS_LABEL: Record<ObserverBasis, string> = {
  leader: 'Leader',
  coach: 'Coach',
  designated: 'Named observer',
};

/** "You lead Maya", "Sam is your coach", "Priya was named to observe Maya". */
export const basisSentence = (
  basis: ObserverBasis,
  viewer: 'observer' | 'subject' | 'viewer',
  observer: string,
  subject: string,
) => {
  if (basis === 'designated') {
    if (viewer === 'observer') return `You were named to observe ${subject}`;
    if (viewer === 'subject') return `${observer} was named to observe you`;
    return `${observer} was named to observe ${subject}`;
  }
  const verb = basis === 'leader' ? 'lead' : 'coach';
  if (viewer === 'observer') return `You ${verb} ${subject}`;
  if (viewer === 'subject') return `${observer} is your ${basis === 'leader' ? 'leader' : 'coach'}`;
  return `${observer} ${verb}s ${subject}`;
};

export const CONVERSATION_STATUS: Record<ConversationStatus, Presentation> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  held: { label: 'Held', tone: 'success' },
  missed: { label: 'Didn’t happen', tone: 'neutral' },
  cancelled: { label: 'Canceled', tone: 'muted' },
};

export const CONVERSATION_EVENT_LABEL: Record<string, string> = {
  HOLD: 'Mark as held',
  MISS: 'It didn’t happen',
  RESCHEDULE: 'Reschedule',
  CANCEL: 'Cancel',
};

export const COMMITMENT_STATUS: Record<CommitmentStatus, Presentation> = {
  open: { label: 'Open', tone: 'neutral' },
  done: { label: 'Done', tone: 'success' },
  dropped: { label: 'Dropped', tone: 'muted' },
};
