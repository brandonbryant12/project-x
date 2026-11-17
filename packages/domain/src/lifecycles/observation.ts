import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * Observation: an eligible observer's first-hand account of an interaction.
 * Only the SIGN transition posts credit (ADR 0007). SIGN is never automated.
 * Minimum to sign: one skill with a level, plus one specific comment.
 *
 * Created as `requested` (the coachee asked) or `drafting` (the observer started
 * it: "I saw this").
 */
export interface ObservationFacts {
  /** 1-3 skills rated, each with a level. Indicators are optional (red-team: micro-CEX). */
  readonly ratingsComplete: boolean;
  /** Characters in "What I saw" — the one specific comment. */
  readonly narrativeLength: number;
  /** Evidence or narrative is held by the privacy screen. */
  readonly privacyHold: boolean;
  /** The subject has acknowledged the signed observation. */
  readonly acknowledged: boolean;
}

export const MIN_NARRATIVE_LENGTH = 40;

export type ObservationEvent =
  | { readonly type: 'START' }
  | { readonly type: 'SAVE_DRAFT' }
  | { readonly type: 'SIGN' }
  | { readonly type: 'RETURN' }
  | { readonly type: 'RESUBMIT' }
  | { readonly type: 'DECLINE' }
  | { readonly type: 'WITHDRAW' }
  | { readonly type: 'EXPIRE' }
  | { readonly type: 'ACKNOWLEDGE' }
  | { readonly type: 'REQUEST_REVIEW' }
  | { readonly type: 'UPHOLD' }
  | { readonly type: 'VOID' };

const observationMachine = setup({
  types: { context: {} as ObservationFacts, events: {} as ObservationEvent },
  guards: {
    readyToSign: ({ context }) =>
      context.ratingsComplete &&
      context.narrativeLength >= MIN_NARRATIVE_LENGTH &&
      !context.privacyHold,
    notAcknowledged: ({ context }) => !context.acknowledged,
  },
}).createMachine({
  id: 'observation',
  initial: 'requested',
  context: { ratingsComplete: false, narrativeLength: 0, privacyHold: false, acknowledged: false },
  states: {
    requested: {
      on: {
        START: 'drafting',
        SAVE_DRAFT: 'drafting',
        SIGN: { target: 'signed', guard: 'readyToSign' },
        RETURN: 'returned',
        DECLINE: 'declined',
        WITHDRAW: 'withdrawn',
        EXPIRE: 'expired',
      },
    },
    drafting: {
      on: {
        SAVE_DRAFT: 'drafting',
        SIGN: { target: 'signed', guard: 'readyToSign' },
        RETURN: 'returned',
        DECLINE: 'declined',
        WITHDRAW: 'withdrawn',
        EXPIRE: 'expired',
      },
    },
    returned: {
      on: { RESUBMIT: 'requested', WITHDRAW: 'withdrawn', EXPIRE: 'expired' },
    },
    // The subject can acknowledge it, or ask for a review if they think it is wrong.
    // Credit stands during a review; only VOID reverses it.
    signed: {
      on: {
        ACKNOWLEDGE: { target: 'signed', guard: 'notAcknowledged' },
        REQUEST_REVIEW: { target: 'under_review', guard: 'notAcknowledged' },
        VOID: 'voided',
      },
    },
    under_review: { on: { UPHOLD: 'signed', VOID: 'voided' } },
    declined: { type: 'final' },
    withdrawn: { type: 'final' },
    expired: { type: 'final' },
    voided: { type: 'final' },
  },
});

export const ObservationLifecycle = defineLifecycle({
  name: 'observation',
  machine: observationMachine,
  states: [
    'requested',
    'drafting',
    'returned',
    'signed',
    'under_review',
    'declined',
    'withdrawn',
    'expired',
    'voided',
  ],
  events: [
    'START',
    'SAVE_DRAFT',
    'SIGN',
    'RETURN',
    'RESUBMIT',
    'DECLINE',
    'WITHDRAW',
    'EXPIRE',
    'ACKNOWLEDGE',
    'REQUEST_REVIEW',
    'UPHOLD',
    'VOID',
  ],
  initialStates: ['requested', 'drafting'],
  terminalStates: ['declined', 'withdrawn', 'expired', 'voided'],
});

export type ObservationStatus = (typeof ObservationLifecycle.states)[number];
export type ObservationEventType = ObservationEvent['type'];
/** States in which the observation is still waiting on someone. */
export const OPEN_OBSERVATION_STATES = ['requested', 'drafting', 'returned'] as const;
