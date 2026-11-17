import type { Actor } from '@repo/api';
import {
  PLAN_REVIEW_STATES,
  PlanLifecycle,
  type ActivityStatus,
  type CreditPolicy,
  type IsoDate,
  type PersonId,
  type PlanStatus,
  type RelationshipFacts,
} from '@repo/domain';
import { planAgreers } from '../shared/plans.ts';

/**
 * Who may do what with a plan and its work, beyond lifecycle events (design §6,
 * §8). The plan view computes its flags from these and the use cases refuse
 * with them, so a control is shown exactly when the server would accept it.
 */
export interface PlanRelation {
  readonly isOwner: boolean;
  /** The owner's engaged coach, or their leader when they have no coach. */
  readonly isAgreer: boolean;
  readonly isProgramOwner: boolean;
}

export const planRelation = (
  actor: Pick<Actor, 'personId' | 'grants'>,
  ownerId: PersonId,
  facts: RelationshipFacts,
  on: IsoDate,
): PlanRelation => ({
  isOwner: actor.personId === ownerId,
  isAgreer: actor.personId !== ownerId && planAgreers(facts, ownerId, on).includes(actor.personId),
  isProgramOwner: actor.grants.includes('program_owner'),
});

export interface PlanState {
  readonly status: string;
  readonly reviewRecordedAt: Date | null;
  readonly reviewConfirmedAt: Date | null;
}

const isTerminal = (plan: PlanState) => PlanLifecycle.isTerminal(plan.status as PlanStatus);
const inReviewState = (plan: PlanState) =>
  (PLAN_REVIEW_STATES as ReadonlyArray<string>).includes(plan.status);

/** A refusal: `forbidden` is about who is asking, `unprocessable` about the state of things. */
export interface Refusal {
  readonly kind: 'forbidden' | 'unprocessable';
  readonly message: string;
}

const forbidden = (message: string): Refusal => ({ kind: 'forbidden', message });
const unprocessable = (message: string): Refusal => ({ kind: 'unprocessable', message });
const CLOSED = unprocessable('This plan is closed.');

export const editPlanRefusal = (who: PlanRelation, plan: PlanState): Refusal | null => {
  if (!who.isOwner) return forbidden('Only the plan’s owner can edit it.');
  return isTerminal(plan) ? CLOSED : null;
};

export const addWorkRefusal = (who: PlanRelation, plan: PlanState): Refusal | null => {
  if (!who.isOwner && !who.isAgreer)
    return forbidden('Only the owner or their coach can add work to a plan.');
  return isTerminal(plan) ? CLOSED : null;
};

export interface WorkState {
  readonly status: string;
  readonly origin: string;
}

const LIVE_WORK: ReadonlyArray<ActivityStatus> = ['planned', 'underway'];
const isLive = (work: WorkState) => (LIVE_WORK as ReadonlyArray<string>).includes(work.status);

/** Planned work that is still open, in a plan that is not closed, by its owner or an agreer. */
export const editWorkRefusal = (
  who: PlanRelation,
  plan: PlanState,
  work: WorkState,
): Refusal | null => {
  if (!who.isOwner && !who.isAgreer)
    return forbidden('Only the owner or their coach can change this work.');
  if (isTerminal(plan)) return CLOSED;
  if (work.origin !== 'planned')
    return unprocessable('Work logged as it happened cannot be changed here.');
  return isLive(work) ? null : unprocessable('This work is closed.');
};

/**
 * An individual value is set when work is planned, never after it is observed
 * (design §6): a plan agreer or a program owner, never the subject whatever
 * grants they hold; the tenant must allow it; the work must be planned, open
 * and have no observation that is open or signed.
 */
export const setValueRefusal = (
  who: PlanRelation,
  overrides: CreditPolicy['activityOverrides'],
  plan: PlanState,
  work: WorkState & { readonly observed: boolean },
): Refusal | null => {
  if (who.isOwner) return forbidden('Someone else sets a value on your work.');
  if (!who.isAgreer && !who.isProgramOwner)
    return forbidden('Only the owner’s coach or a program owner can set a value.');
  if (!overrides.enabled) return unprocessable('Individual values are switched off.');
  if (isTerminal(plan)) return CLOSED;
  if (work.origin !== 'planned')
    return unprocessable('Work logged as it happened has already been done; it cannot be valued.');
  if (!isLive(work)) return unprocessable('This work is closed.');
  return work.observed
    ? unprocessable('This work has an open or signed observation; its value can no longer change.')
    : null;
};

export const recordReviewRefusal = (who: PlanRelation, plan: PlanState): Refusal | null => {
  if (!who.isOwner) return forbidden('The plan’s owner records the closing review.');
  if (plan.reviewConfirmedAt) return unprocessable('The closing review is confirmed and fixed.');
  return inReviewState(plan)
    ? null
    : unprocessable('Record the closing review once the plan is agreed.');
};

export const confirmReviewRefusal = (who: PlanRelation, plan: PlanState): Refusal | null => {
  if (!who.isAgreer)
    return forbidden('The owner’s coach, or their leader if they have no coach, confirms it.');
  if (!plan.reviewRecordedAt) return unprocessable('There is no closing review to confirm yet.');
  if (plan.reviewConfirmedAt) return unprocessable('The closing review is already confirmed.');
  return inReviewState(plan) ? null : unprocessable('This plan has no closing review to confirm.');
};

/** The flags a plan view carries for its viewer. */
export const planCapabilities = (who: PlanRelation, plan: PlanState) => ({
  canEdit: editPlanRefusal(who, plan) === null,
  canEditFocusSkills: editPlanRefusal(who, plan) === null && plan.status === 'draft',
  canAddWork: addWorkRefusal(who, plan) === null,
  canRecordReview: recordReviewRefusal(who, plan) === null,
  canConfirmReview: confirmReviewRefusal(who, plan) === null,
});
