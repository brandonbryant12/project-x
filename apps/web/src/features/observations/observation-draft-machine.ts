import type { ObservationView, RatingInput } from '@repo/api';
import {
  MIN_NARRATIVE_LENGTH,
  type Level,
  type ObservationMode,
  type SkillId,
  type SkillIndicatorId,
} from '@repo/domain';
import { Cause, Effect, Exit, Option } from 'effect';
import { assign, fromPromise, setup } from 'xstate';
import { isConflict, type ApiClientError } from '@/lib/api.ts';

export interface DraftRating {
  readonly skillId: SkillId;
  readonly level: Level | null;
  readonly indicatorIds: ReadonlyArray<SkillIndicatorId>;
  readonly credit: boolean;
}

export interface Draft {
  /** How the observer knows; they confirm or correct the coachee's request. */
  readonly mode: ObservationMode;
  readonly ratings: ReadonlyArray<DraftRating>;
  readonly narrativeSaw: string;
  readonly narrativeNext: string;
}

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly at: number }
  | { readonly kind: 'failed' }
  | { readonly kind: 'conflict' };

export const MIN_SAW = MIN_NARRATIVE_LENGTH;

export const draftFromView = (view: ObservationView): Draft => ({
  mode: view.mode,
  ratings: view.ratings.map((r) => ({
    skillId: r.skill.id,
    level: r.level,
    indicatorIds: r.indicatorIds,
    credit: r.credit,
  })),
  narrativeSaw: view.narrativeSaw,
  narrativeNext: view.narrativeNext,
});

export const toPayload = (
  draft: Draft,
  version: number,
): {
  version: number;
  mode: ObservationMode;
  ratings: Array<RatingInput>;
  narrativeSaw: string;
  narrativeNext: string;
} => ({
  version,
  mode: draft.mode,
  ratings: draft.ratings.map((r) => ({
    skillId: r.skillId,
    level: r.level,
    indicatorIds: [...r.indicatorIds],
    credit: r.credit,
  })),
  narrativeSaw: draft.narrativeSaw,
  narrativeNext: draft.narrativeNext,
});

/** What still blocks publishing, in plain words (minimums from the domain). */
export const missingToSign = (draft: Draft): string | null => {
  if (draft.ratings.length === 0) return 'Choose a skill you saw';
  if (draft.ratings.some((r) => r.level === null)) return 'Pick a level for each skill';
  if (draft.narrativeSaw.trim().length < MIN_SAW) return 'Add what you saw to publish';
  return null;
};

export type SaveOutcome =
  | { readonly _tag: 'Saved'; readonly view: ObservationView; readonly at: number }
  | { readonly _tag: 'Conflict' }
  | { readonly _tag: 'Failed' };

export type SaveDraftEffect = (
  draft: Draft,
  version: number,
) => Effect.Effect<ObservationView, ApiClientError>;

export interface ObservationDraftContext {
  readonly draft: Draft;
  readonly version: number;
  readonly savedAt: number | null;
  readonly queuedEdit: boolean;
}

export type ObservationDraftEvent =
  | { readonly type: 'EDIT'; readonly change: (draft: Draft) => Draft }
  | { readonly type: 'SYNC_SERVER'; readonly view: ObservationView }
  | { readonly type: 'CANCEL_PENDING' };

const runSaveEffect = async (
  saveEffect: SaveDraftEffect,
  draft: Draft,
  version: number,
  now: () => number,
): Promise<SaveOutcome> => {
  const exit = await Effect.runPromiseExit(saveEffect(draft, version));
  if (Exit.isSuccess(exit)) {
    return { _tag: 'Saved', view: exit.value, at: now() };
  }
  const error = Cause.findErrorOption(exit.cause);
  return Option.isSome(error) && isConflict(error.value)
    ? { _tag: 'Conflict' }
    : { _tag: 'Failed' };
};

export interface ObservationDraftMachineOptions {
  readonly initialView: ObservationView;
  readonly saveEffect: SaveDraftEffect;
  readonly onSaved?: (view: ObservationView) => void;
  readonly debounceMs?: number;
  readonly now?: () => number;
}

/**
 * Pure XState 5 autosave machine backed by Effect.
 * Declaratively handles 800ms debounce, in-flight edit queueing, server sync adoption,
 * optimistic-concurrency conflicts, and cancellation before publish.
 */
export const createObservationDraftMachine = ({
  initialView,
  saveEffect,
  onSaved,
  debounceMs = 800,
  now = () => Date.now(),
}: ObservationDraftMachineOptions) =>
  setup({
    types: {
      context: {} as ObservationDraftContext,
      events: {} as ObservationDraftEvent,
    },
    delays: {
      autosaveDelay: debounceMs,
    },
    actors: {
      persistDraft: fromPromise<SaveOutcome, { readonly draft: Draft; readonly version: number }>(
        ({ input }) => runSaveEffect(saveEffect, input.draft, input.version, now),
      ),
    },
    guards: {
      hasNewerVersion: ({ context, event }) =>
        event.type === 'SYNC_SERVER' && event.view.version !== context.version,
      isSaved: (_, params: SaveOutcome) => params._tag === 'Saved',
      isConflictOutcome: (_, params: SaveOutcome) => params._tag === 'Conflict',
      hasQueuedEdit: ({ context }) => context.queuedEdit,
    },
    actions: {
      applyEdit: assign(({ context, event }) => {
        if (event.type !== 'EDIT') return {};
        return { draft: event.change(context.draft) };
      }),
      applyEditAndQueue: assign(({ context, event }) => {
        if (event.type !== 'EDIT') return {};
        return { draft: event.change(context.draft), queuedEdit: true };
      }),
      adoptServer: assign(({ event }) => {
        if (event.type !== 'SYNC_SERVER') return {};
        return { draft: draftFromView(event.view), version: event.view.version };
      }),
      commitSaved: assign(({ event }) => {
        const output = (event as { readonly output?: SaveOutcome }).output;
        if (!output || output._tag !== 'Saved') return {};
        onSaved?.(output.view);
        return { version: output.view.version, savedAt: output.at };
      }),
      clearQueue: assign({ queuedEdit: false }),
    },
  }).createMachine({
    id: 'observationDraft',
    initial: 'idle',
    context: {
      draft: draftFromView(initialView),
      version: initialView.version,
      savedAt: null,
      queuedEdit: false,
    },
    states: {
      idle: {
        on: {
          EDIT: { target: 'dirty', actions: 'applyEdit' },
          SYNC_SERVER: { guard: 'hasNewerVersion', actions: 'adoptServer' },
        },
      },
      dirty: {
        on: {
          EDIT: { target: 'dirty', reenter: true, actions: 'applyEdit' },
          CANCEL_PENDING: { target: 'idle' },
        },
        after: {
          autosaveDelay: { target: 'saving' },
        },
      },
      saving: {
        entry: 'clearQueue',
        on: {
          EDIT: { actions: 'applyEditAndQueue' },
          CANCEL_PENDING: { target: 'idle' },
        },
        invoke: {
          src: 'persistDraft',
          input: ({ context }) => ({ draft: context.draft, version: context.version }),
          onDone: [
            {
              guard: { type: 'isSaved', params: ({ event }) => event.output },
              actions: 'commitSaved',
              target: 'afterSave',
            },
            {
              guard: { type: 'isConflictOutcome', params: ({ event }) => event.output },
              target: 'conflict',
            },
            { target: 'failed' },
          ],
          onError: { target: 'failed' },
        },
      },
      afterSave: {
        always: [{ guard: 'hasQueuedEdit', target: 'dirty' }, { target: 'saved' }],
      },
      saved: {
        on: {
          EDIT: { target: 'dirty', actions: 'applyEdit' },
          SYNC_SERVER: { guard: 'hasNewerVersion', actions: 'adoptServer' },
        },
      },
      failed: {
        on: {
          EDIT: { target: 'dirty', actions: 'applyEdit' },
          SYNC_SERVER: { guard: 'hasNewerVersion', target: 'idle', actions: 'adoptServer' },
        },
      },
      conflict: {
        on: {
          SYNC_SERVER: { guard: 'hasNewerVersion', target: 'idle', actions: 'adoptServer' },
        },
      },
    },
  });

export const saveStateFromSnapshot = (value: unknown, savedAt: number | null): SaveState => {
  if (value === 'saving') return { kind: 'saving' };
  if (value === 'saved' && savedAt !== null) return { kind: 'saved', at: savedAt };
  if (value === 'failed') return { kind: 'failed' };
  if (value === 'conflict') return { kind: 'conflict' };
  return { kind: 'idle' };
};

export const describeSave = (save: SaveState, now = Date.now()) => {
  switch (save.kind) {
    case 'idle':
      return '';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return now - save.at < 60_000 ? 'Saved just now' : 'Saved';
    case 'failed':
      return 'Not saved. Check your connection';
    case 'conflict':
      return 'This changed elsewhere';
  }
};
