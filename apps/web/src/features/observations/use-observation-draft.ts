import type { ObservationView } from '@repo/api';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { callEffect, queryOptions } from '@/lib/api.ts';
import { useMachine } from '@/lib/foldkit.ts';
import {
  createObservationDraftMachine,
  describeSave,
  MIN_SAW,
  missingToSign,
  saveStateFromSnapshot,
  toPayload,
  type Draft,
  type DraftRating,
} from './observation-draft-machine.ts';

export { describeSave, MIN_SAW, missingToSign, toPayload, type Draft, type DraftRating };

/**
 * Local draft state with honest XState 5 debounced autosave backed by Effect.
 * The server version travels with every save; a Conflict means another window changed it.
 */
export const useObservationDraft = (view: ObservationView, editable: boolean) => {
  const qc = useQueryClient();
  const key = useMemo(
    () => queryOptions('observations', 'get', { params: { id: view.id } }).queryKey,
    [view.id],
  );

  const machine = useMemo(
    () =>
      createObservationDraftMachine({
        initialView: view,
        saveEffect: (draft, version) =>
          callEffect('observations', 'saveDraft', {
            params: { id: view.id },
            payload: toPayload(draft, version),
          }),
        onSaved: (saved) => {
          qc.setQueryData(key, saved);
        },
      }),
    // Only create a new machine if the observation ID changes; server updates arrive via SYNC_SERVER.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.id],
  );

  const [snapshot, send] = useMachine(machine);

  useEffect(() => {
    send({ type: 'SYNC_SERVER', view });
  }, [send, view]);

  const update = useCallback(
    (change: (d: Draft) => Draft) => {
      if (!editable) return;
      send({ type: 'EDIT', change });
    },
    [editable, send],
  );

  const cancelPendingSave = useCallback(() => {
    send({ type: 'CANCEL_PENDING' });
  }, [send]);

  const save = saveStateFromSnapshot(snapshot.value, snapshot.context.savedAt);

  return {
    draft: snapshot.context.draft,
    update,
    save,
    version: () => snapshot.context.version,
    cancelPendingSave,
  };
};
