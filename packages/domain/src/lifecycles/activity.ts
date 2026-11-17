import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * Activity: one item of planned real work. Becomes `underway` with its first
 * interaction. Canceling keeps history and never reverses credit.
 */
export type ActivityEvent =
  | { readonly type: 'LOG_INTERACTION' }
  | { readonly type: 'COMPLETE' }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'EXPIRE' };

const activityMachine = setup({
  types: { context: {} as Record<string, never>, events: {} as ActivityEvent },
}).createMachine({
  id: 'activity',
  initial: 'planned',
  context: {},
  states: {
    planned: {
      on: { LOG_INTERACTION: 'underway', CANCEL: 'canceled', EXPIRE: 'expired' },
    },
    underway: {
      on: { LOG_INTERACTION: 'underway', COMPLETE: 'done', CANCEL: 'canceled' },
    },
    done: { type: 'final' },
    canceled: { type: 'final' },
    expired: { type: 'final' },
  },
});

export const ActivityLifecycle = defineLifecycle({
  name: 'activity',
  machine: activityMachine,
  states: ['planned', 'underway', 'done', 'canceled', 'expired'],
  events: ['LOG_INTERACTION', 'COMPLETE', 'CANCEL', 'EXPIRE'],
  initialStates: ['planned', 'underway'],
  terminalStates: ['done', 'canceled', 'expired'],
});

export type ActivityStatus = (typeof ActivityLifecycle.states)[number];
export type ActivityEventType = ActivityEvent['type'];
/** Days after the due date before an activity with no interactions expires. */
export const ACTIVITY_GRACE_DAYS = 14;
