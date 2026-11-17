import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * DirectoryException (ADR 0006): a rule violation or unappliable row found by
 * the directory import or a departure. A tenant admin acknowledges it (the fix
 * belongs in HR); a later applied import that no longer finds it resolves it.
 */
export type DirectoryExceptionEvent =
  | { readonly type: 'ACKNOWLEDGE' }
  | { readonly type: 'RESOLVE' };

const directoryExceptionMachine = setup({
  types: { context: {} as Record<string, never>, events: {} as DirectoryExceptionEvent },
}).createMachine({
  id: 'directory_exception',
  initial: 'open',
  context: {},
  states: {
    open: { on: { ACKNOWLEDGE: 'acknowledged', RESOLVE: 'resolved' } },
    acknowledged: { on: { RESOLVE: 'resolved' } },
    resolved: { type: 'final' },
  },
});

export const DirectoryExceptionLifecycle = defineLifecycle({
  name: 'directory exception',
  machine: directoryExceptionMachine,
  states: ['open', 'acknowledged', 'resolved'],
  events: ['ACKNOWLEDGE', 'RESOLVE'],
  initialStates: ['open'],
  terminalStates: ['resolved'],
});

export type DirectoryExceptionStatus = (typeof DirectoryExceptionLifecycle.states)[number];
export type DirectoryExceptionEventType = DirectoryExceptionEvent['type'];
