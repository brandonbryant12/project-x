import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * DevelopmentPlan: a coachee's plan for a period. Agreed between the coachee and
 * their coach (or leader when they have no coach). A leader may endorse; that is
 * recognition, not a gate. One current plan per person (DB partial unique index).
 */
export interface PlanFacts {
  readonly focusSkillCount: number;
  readonly activityCount: number;
  readonly endorsed: boolean;
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
      context.focusSkillCount >= 1 && context.focusSkillCount <= MAX_FOCUS_SKILLS,
    notEndorsed: ({ context }) => !context.endorsed,
  },
}).createMachine({
  id: 'plan',
  initial: 'draft',
  context: { focusSkillCount: 0, activityCount: 0, endorsed: false },
  states: {
    draft: {
      on: { PROPOSE: { target: 'proposed', guard: 'proposable' }, CANCEL: 'canceled' },
    },
    proposed: {
      on: {
        AGREE: 'active',
        REVISE: 'draft',
        ENDORSE: { target: 'proposed', guard: 'notEndorsed' },
        CANCEL: 'canceled',
        EXPIRE: 'expired',
      },
    },
    active: {
      on: {
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
  initialStates: ['draft', 'active'],
  terminalStates: ['completed', 'canceled', 'expired'],
});

export type PlanStatus = (typeof PlanLifecycle.states)[number];
export type PlanEventType = PlanEvent['type'];
/** A person has at most one plan in these states. */
export const CURRENT_PLAN_STATES = ['draft', 'proposed', 'active', 'paused'] as const;
/** Days after period end before an unfinished plan expires. */
export const PLAN_GRACE_DAYS = 14;
