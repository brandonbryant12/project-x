import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * DevelopmentPlan: a coachee's plan for a period. Agreed between the coachee and
 * their coach (or leader when they have no coach). A leader may endorse; that is
 * recognition, not a gate. One current plan per person (DB partial unique index).
 *
 * An agreed plan can be revised back to a draft, changed and agreed again; a
 * revision clears the agreement, the endorsement and any closing review that is
 * not yet confirmed. Once a closing review is confirmed the plan can no longer
 * be revised. A draft expires like any other unfinished plan, so a plan revised
 * after its period never blocks the owner's next one.
 *
 * The closing review is a fact recorded beside the plan, not a state of it.
 */
export interface PlanFacts {
  readonly focusSkillCount: number;
  readonly activityCount: number;
  readonly endorsed: boolean;
  /** An agreer has confirmed the closing review; it is fixed. */
  readonly reviewConfirmed: boolean;
}

export const MAX_FOCUS_SKILLS = 3;

export type PlanEvent =
  | { readonly type: 'PROPOSE' }
  | { readonly type: 'REVISE' }
  | { readonly type: 'AGREE' }
  | { readonly type: 'ENDORSE' }
  | { readonly type: 'PAUSE' }
  | { readonly type: 'RESUME' }
  | { readonly type: 'COMPLETE' }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'EXPIRE' };

const planMachine = setup({
  types: { context: {} as PlanFacts, events: {} as PlanEvent },
  guards: {
    proposable: ({ context }) =>
      context.focusSkillCount >= 1 &&
      context.focusSkillCount <= MAX_FOCUS_SKILLS &&
      context.activityCount >= 1,
    notEndorsed: ({ context }) => !context.endorsed,
    reviewOpen: ({ context }) => !context.reviewConfirmed,
  },
}).createMachine({
  id: 'plan',
  initial: 'draft',
  context: { focusSkillCount: 0, activityCount: 0, endorsed: false, reviewConfirmed: false },
  states: {
    draft: {
      on: {
        PROPOSE: { target: 'proposed', guard: 'proposable' },
        CANCEL: 'canceled',
        EXPIRE: 'expired',
      },
    },
    proposed: {
      on: {
        AGREE: 'active',
        REVISE: { target: 'draft', guard: 'reviewOpen' },
        ENDORSE: { target: 'proposed', guard: 'notEndorsed' },
        CANCEL: 'canceled',
        EXPIRE: 'expired',
      },
    },
    active: {
      on: {
        REVISE: { target: 'draft', guard: 'reviewOpen' },
        ENDORSE: { target: 'active', guard: 'notEndorsed' },
        PAUSE: 'paused',
        COMPLETE: 'completed',
        CANCEL: 'canceled',
        EXPIRE: 'expired',
      },
    },
    paused: { on: { RESUME: 'active', CANCEL: 'canceled', EXPIRE: 'expired' } },
    completed: { type: 'final' },
    canceled: { type: 'final' },
    expired: { type: 'final' },
  },
});

export const PlanLifecycle = defineLifecycle({
  name: 'plan',
  machine: planMachine,
  states: ['draft', 'proposed', 'active', 'paused', 'completed', 'canceled', 'expired'],
  events: [
    'PROPOSE',
    'REVISE',
    'AGREE',
    'ENDORSE',
    'PAUSE',
    'RESUME',
    'COMPLETE',
    'CANCEL',
    'EXPIRE',
  ],
  initialStates: ['draft'],
  terminalStates: ['completed', 'canceled', 'expired'],
});

export type PlanStatus = (typeof PlanLifecycle.states)[number];
export type PlanEventType = PlanEvent['type'];
/** A person has at most one plan in these states. */
export const CURRENT_PLAN_STATES = ['draft', 'proposed', 'active', 'paused'] as const;
/** States in which the owner may record the closing review (it is never forced). */
export const PLAN_REVIEW_STATES = ['active', 'paused', 'completed', 'expired'] as const;
/** What became of one focus skill, in the closing review. Never computed from badges. */
export const PLAN_OUTCOMES = ['achieved', 'partly', 'carried_over', 'not_pursued'] as const;
export type PlanOutcome = (typeof PLAN_OUTCOMES)[number];
/** Days after period end before an unfinished plan expires. */
export const PLAN_GRACE_DAYS = 14;
