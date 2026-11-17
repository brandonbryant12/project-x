import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * Evidence: a reflection or notes attached to an interaction (ADR 0012).
 *  - screening: the local pre-filter passed; the assistant screen is pending.
 *  - held: suspected client PII. Visible only to its author and admins until the
 *    author revises it or an admin releases it.
 *  - escalated: describes a complaint or a specific recommendation. That is a
 *    matter for compliance, not something to edit away; a compliance reviewer
 *    resolves it.
 * Only humans RELEASE or RESOLVE.
 */
export type EvidenceEvent =
  | { readonly type: 'CLEAR' }
  | { readonly type: 'HOLD' }
  | { readonly type: 'ESCALATE' }
  | { readonly type: 'REVISE' }
  | { readonly type: 'RELEASE' }
  | { readonly type: 'RESOLVE' };

const evidenceMachine = setup({
  types: { context: {} as Record<string, never>, events: {} as EvidenceEvent },
}).createMachine({
  id: 'evidence',
  initial: 'screening',
  context: {},
  states: {
    screening: { on: { CLEAR: 'available', HOLD: 'held', ESCALATE: 'escalated' } },
    held: { on: { REVISE: 'screening', RELEASE: 'available' } },
    escalated: { on: { RESOLVE: 'available' } },
    available: { on: { REVISE: 'screening', HOLD: 'held', ESCALATE: 'escalated' } },
  },
});

export const EvidenceLifecycle = defineLifecycle({
  name: 'evidence',
  machine: evidenceMachine,
  states: ['screening', 'held', 'escalated', 'available'],
  events: ['CLEAR', 'HOLD', 'ESCALATE', 'REVISE', 'RELEASE', 'RESOLVE'],
  initialStates: ['screening'],
  terminalStates: [],
});

export type EvidenceStatus = (typeof EvidenceLifecycle.states)[number];
