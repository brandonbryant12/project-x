import type { ObservationView, RatingInput } from '@repo/api';
import type { Level, ObservationMode, SkillId, SkillIndicatorId, SkillRole } from '@repo/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call, queryOptions } from '@/lib/api.ts';

export interface DraftRating {
  readonly skillId: SkillId;
  readonly level: Level | null;
  readonly indicatorIds: ReadonlyArray<SkillIndicatorId>;
  readonly credit: boolean;
  /** The observer owns it (design §4): at most one skill is primary. */
  readonly role: SkillRole;
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

export const MIN_SAW = 40;

const fromView = (view: ObservationView): Draft => ({
  mode: view.mode,
  ratings: view.ratings.map((r) => ({
    skillId: r.skill.id,
    level: r.level,
    indicatorIds: r.indicatorIds,
    credit: r.credit,
    // `unclassified` exists only on ratings signed before roles; never on a draft.
    role: r.role === 'primary' ? 'primary' : 'secondary',
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
    role: r.role,
  })),
  narrativeSaw: draft.narrativeSaw,
  narrativeNext: draft.narrativeNext,
});

/** Gives one skill a role; making it primary makes any other primary secondary. */
export const withRole = (
  ratings: ReadonlyArray<DraftRating>,
  skillId: SkillId,
  role: SkillRole,
): ReadonlyArray<DraftRating> =>
  ratings.map((r) => {
    if (r.skillId === skillId) return { ...r, role };
    return role === 'primary' && r.role === 'primary' ? { ...r, role: 'secondary' } : r;
  });

const listed = (names: ReadonlyArray<string>) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * The one quiet line about what signing adds, from the server's values for
 * each rated skill in its role. Feedback-only skills add nothing. Null while a
 * value is unknown (a skill added since the last save).
 */
export const signingAdds = (
  ratings: ReadonlyArray<DraftRating>,
  valueOf: (skillId: SkillId) => Readonly<Record<SkillRole, number>> | null,
  nameOf: (skillId: SkillId) => string,
): string | null => {
  const credited = ratings.filter((r) => r.credit);
  if (credited.length === 0) return 'Feedback only: signing adds nothing to the record.';
  const parts: Array<string> = [];
  for (const r of credited) {
    const values = valueOf(r.skillId);
    if (!values) return null;
    const points = values[r.role];
    const unit = parts.length === 0 ? ` ${points === 1 ? 'point' : 'points'}` : '';
    parts.push(`${points}${unit} to ${nameOf(r.skillId)}`);
  }
  return `Signing adds ${listed(parts)}.`;
};

/** What still blocks signing, in plain words (minimums from the domain). */
export const missingToSign = (draft: Draft): string | null => {
  if (draft.ratings.length === 0) return 'Choose a skill you saw';
  if (draft.ratings.some((r) => r.level === null)) return 'Pick a level for each skill';
  if (draft.narrativeSaw.trim().length < MIN_SAW) return 'Add what you saw to sign';
  return null;
};

/**
 * Local draft state with honest autosave (800ms debounce). The server version
 * travels with every save; a Conflict means another window changed it.
 */
export const useObservationDraft = (view: ObservationView, editable: boolean) => {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => fromView(view));
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const version = useRef(view.version);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = queryOptions('observations', 'get', { params: { id: view.id } }).queryKey;

  // Adopt server state only when we have no unsaved local edits.
  useEffect(() => {
    if (!dirty.current && view.version !== version.current) {
      version.current = view.version;
      setDraft(fromView(view));
    }
  }, [view]);

  const flush = useCallback(
    async (next: Draft) => {
      setSave({ kind: 'saving' });
      try {
        const saved = await call('observations', 'saveDraft', {
          params: { id: view.id },
          payload: toPayload(next, version.current),
        });
        version.current = saved.version;
        dirty.current = false;
        setSave({ kind: 'saved', at: Date.now() });
        qc.setQueryData(key, saved);
      } catch (error) {
        const tag = (error as { _tag?: string })._tag;
        setSave({ kind: tag === 'Conflict' ? 'conflict' : 'failed' });
      }
    },
    [view.id, qc, key],
  );

  const update = useCallback(
    (change: (d: Draft) => Draft) => {
      if (!editable) return;
      setDraft((current) => {
        const next = change(current);
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(next), 800);
        return next;
      });
    },
    [editable, flush],
  );

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return {
    draft,
    update,
    save,
    version: () => version.current,
    cancelPendingSave: () => timer.current && clearTimeout(timer.current),
  };
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
