import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * AdvisoryCheck: one Decisions API evaluation (ADR 0008). It may hold or nudge;
 * nothing downstream treats `completed` as clearance. `skipped` means Decisions
 * is disabled, the input was empty, or the local screen held the text so it was
 * never sent; `failed` covers provider errors and unknown outcomes. A check is
 * never retried in place; the server's screening sweep may start a new check,
 * a bounded number of times.
 */
export type AdvisoryCheckEvent =
  | { readonly type: 'COMPLETE' }
  | { readonly type: 'FAIL' }
  | { readonly type: 'SKIP' };

const advisoryCheckMachine = setup({
  types: { context: {} as Record<string, never>, events: {} as AdvisoryCheckEvent },
}).createMachine({
  id: 'advisoryCheck',
  initial: 'pending',
  context: {},
  states: {
    pending: { on: { COMPLETE: 'completed', FAIL: 'failed', SKIP: 'skipped' } },
    completed: { type: 'final' },
    failed: { type: 'final' },
    skipped: { type: 'final' },
  },
});

export const AdvisoryCheckLifecycle = defineLifecycle({
  name: 'advisoryCheck',
  machine: advisoryCheckMachine,
  states: ['pending', 'completed', 'failed', 'skipped'],
  events: ['COMPLETE', 'FAIL', 'SKIP'],
  initialStates: ['pending'],
  terminalStates: ['completed', 'failed', 'skipped'],
});

export type AdvisoryCheckStatus = (typeof AdvisoryCheckLifecycle.states)[number];
