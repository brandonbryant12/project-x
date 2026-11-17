import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * CoachingEngagement: a coach <-> coachee relationship in the mesh. Either side
 * may propose; the other side accepts. Carries no reporting authority.
 */
export interface EngagementFacts {
  /** The coach holds an active `coach` grant. */
  readonly coachGrantActive: boolean;
}

export type EngagementEvent =
  | { readonly type: 'ACCEPT' }
  | { readonly type: 'DECLINE' }
  | { readonly type: 'WITHDRAW' }
  | { readonly type: 'EXPIRE' }
  | { readonly type: 'PAUSE' }
  | { readonly type: 'RESUME' }
  | { readonly type: 'END' };

const engagementMachine = setup({
  types: { context: {} as EngagementFacts, events: {} as EngagementEvent },
  guards: { coachGrantActive: ({ context }) => context.coachGrantActive },
}).createMachine({
  id: 'engagement',
  initial: 'proposed',
  context: { coachGrantActive: true },
  states: {
    proposed: {
      on: {
        ACCEPT: { target: 'active', guard: 'coachGrantActive' },
        DECLINE: 'declined',
        WITHDRAW: 'withdrawn',
        EXPIRE: 'expired',
      },
    },
    active: { on: { PAUSE: 'paused', END: 'ended' } },
    paused: {
      on: { RESUME: { target: 'active', guard: 'coachGrantActive' }, END: 'ended' },
    },
    ended: { type: 'final' },
    declined: { type: 'final' },
    withdrawn: { type: 'final' },
    expired: { type: 'final' },
  },
});

export const EngagementLifecycle = defineLifecycle({
  name: 'engagement',
  machine: engagementMachine,
  states: ['proposed', 'active', 'paused', 'ended', 'declined', 'withdrawn', 'expired'],
  events: ['ACCEPT', 'DECLINE', 'WITHDRAW', 'EXPIRE', 'PAUSE', 'RESUME', 'END'],
  initialStates: ['proposed'],
  terminalStates: ['ended', 'declined', 'withdrawn', 'expired'],
});

export type EngagementStatus = (typeof EngagementLifecycle.states)[number];
export type EngagementEventType = EngagementEvent['type'];
export const ENGAGEMENT_PROPOSAL_DAYS = 14;
