import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * CoachingConversation (ADR 0019): a scheduled conversation between a coachee
 * and their coach or leader. A leader's 1:1 and a coaching session are the same
 * object. Its agenda is assembled from facts, never stored.
 */
export interface ConversationFacts {
  /** The scheduled time has arrived (a conversation is held or missed only after it starts). */
  readonly started: boolean;
}

export type ConversationEvent =
  | { readonly type: 'HOLD' }
  | { readonly type: 'MISS' }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'RESCHEDULE' };

const conversationMachine = setup({
  types: { context: {} as ConversationFacts, events: {} as ConversationEvent },
  guards: { started: ({ context }) => context.started },
}).createMachine({
  id: 'conversation',
  initial: 'scheduled',
  context: { started: true },
  states: {
    scheduled: {
      on: {
        HOLD: { target: 'held', guard: 'started' },
        MISS: { target: 'missed', guard: 'started' },
        CANCEL: 'cancelled',
        RESCHEDULE: 'scheduled',
      },
    },
    held: { type: 'final' },
    missed: { type: 'final' },
    cancelled: { type: 'final' },
  },
});

export const ConversationLifecycle = defineLifecycle({
  name: 'conversation',
  machine: conversationMachine,
  states: ['scheduled', 'held', 'missed', 'cancelled'],
  events: ['HOLD', 'MISS', 'CANCEL', 'RESCHEDULE'],
  initialStates: ['scheduled'],
  terminalStates: ['held', 'missed', 'cancelled'],
});

export type ConversationStatus = (typeof ConversationLifecycle.states)[number];
export type ConversationEventType = ConversationEvent['type'];
/** A scheduled conversation nobody closes is marked missed this many days later. */
export const CONVERSATION_AUTO_MISS_DAYS = 7;
