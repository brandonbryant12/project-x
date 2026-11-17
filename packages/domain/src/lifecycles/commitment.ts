import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * Commitment (ADR 0019): something the coachee agreed to do next, from an
 * observer's "next step" or from a conversation. It carries forward until done
 * or dropped. It never earns credit.
 */
export type CommitmentEvent =
  | { readonly type: 'COMPLETE' }
  | { readonly type: 'DROP' }
  | { readonly type: 'REOPEN' };

const commitmentMachine = setup({
  types: { context: {} as Record<string, never>, events: {} as CommitmentEvent },
}).createMachine({
  id: 'commitment',
  initial: 'open',
  context: {},
  states: {
    open: { on: { COMPLETE: 'done', DROP: 'dropped' } },
    done: { on: { REOPEN: 'open' } },
    dropped: { on: { REOPEN: 'open' } },
  },
});

export const CommitmentLifecycle = defineLifecycle({
  name: 'commitment',
  machine: commitmentMachine,
  states: ['open', 'done', 'dropped'],
  events: ['COMPLETE', 'DROP', 'REOPEN'],
  initialStates: ['open'],
  terminalStates: [],
});

export type CommitmentStatus = (typeof CommitmentLifecycle.states)[number];
export type CommitmentEventType = CommitmentEvent['type'];
export const MAX_COMMITMENT_LENGTH = 280;
