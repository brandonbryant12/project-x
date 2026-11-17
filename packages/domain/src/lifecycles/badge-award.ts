import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * BadgeAward: awarded automatically when criteria are met over human-signed
 * credit. Revoked only when a VOID reversal breaks the criteria.
 */
export type BadgeAwardEvent = { readonly type: 'REVOKE' };

const badgeAwardMachine = setup({
  types: { context: {} as Record<string, never>, events: {} as BadgeAwardEvent },
}).createMachine({
  id: 'badgeAward',
  initial: 'awarded',
  context: {},
  states: {
    awarded: { on: { REVOKE: 'revoked' } },
    revoked: { type: 'final' },
  },
});

export const BadgeAwardLifecycle = defineLifecycle({
  name: 'badgeAward',
  machine: badgeAwardMachine,
  states: ['awarded', 'revoked'],
  events: ['REVOKE'],
  initialStates: ['awarded'],
  terminalStates: ['revoked'],
});

export type BadgeAwardStatus = (typeof BadgeAwardLifecycle.states)[number];
