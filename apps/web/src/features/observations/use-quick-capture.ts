import type { InboxView, ObservationView, ObserveTarget, SkillRef } from '@repo/api';
import {
  MAX_SKILLS_PER_OBSERVATION,
  OBSERVE_WINDOW_DAYS,
  screenLocally,
  type ActivityId,
  type InteractionKind,
  type IsoDate,
  type ObservationId,
  type SkillId,
} from '@repo/domain';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { call, queryOptions } from '@/lib/api.ts';
import { daysAgoIso, todayIso } from '@/lib/format.ts';
import { missingToSign, toPayload, type Draft, type DraftRating } from './use-observation-draft.ts';

/** Most recent people this observer captured, newest first (a per-device convenience). */
const RECENT_KEY = 'cc-observe-recent';
const readRecent = (): ReadonlyArray<string> => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const rememberRecent = (personId: string) => {
  try {
    const next = [personId, ...readRecent().filter((id) => id !== personId)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: the ordering simply falls back.
  }
};

/**
 * Most likely first: someone who asked you to observe them, then the people you
 * captured recently, then anyone with a plan (coachees before reports), then
 * by name. It never ranks people by progress.
 */
export const rankTargets = (
  targets: ReadonlyArray<ObserveTarget>,
  askedBy: ReadonlySet<string>,
  recent: ReadonlyArray<string>,
): ReadonlyArray<ObserveTarget> => {
  const score = (t: ObserveTarget) => {
    if (askedBy.has(t.person.id)) return 0;
    const r = recent.indexOf(t.person.id);
    if (r >= 0) return 1 + r / 10;
    const coach = t.basis === 'leader' ? 1 : 0;
    return (t.focusSkills.length > 0 ? 2 : 4) + coach;
  };
  return targets.toSorted(
    (a, b) => score(a) - score(b) || a.person.displayName.localeCompare(b.person.displayName),
  );
};

export type When = 'today' | 'yesterday' | 'earlier';

/** The default skill: the person's first focus skill, else their first planned skill. */
const firstSkills = (target: ObserveTarget | undefined): ReadonlyArray<SkillRef> => {
  const first = target?.focusSkills[0] ?? target?.activities[0]?.targetSkills[0];
  return first ? [first] : [];
};

const emptyRating = (skillId: SkillId): DraftRating => ({
  skillId,
  level: null,
  indicatorIds: [],
  credit: true,
});

const blocker = (
  target: ObserveTarget | undefined,
  outsideWindow: boolean,
  privacyHeld: boolean,
  draft: Draft,
): string | null => {
  if (!target) return 'Choose who you observed';
  if (outsideWindow) return `Choose a day in the last ${OBSERVE_WINDOW_DAYS} days`;
  if (privacyHeld) return 'Remove client details to sign';
  return missingToSign(draft);
};

/**
 * State and server calls for the one-screen capture. Nothing is written until
 * the observer signs or saves for later; after that first write the same
 * observer-only draft is reused, so a retry never starts a second one.
 */
export const useQuickCapture = (
  targets: ReadonlyArray<ObserveTarget>,
  inbox: InboxView | undefined,
  preselect: string | undefined,
) => {
  const qc = useQueryClient();
  const [recent] = useState(readRecent);
  const people = useMemo(
    () => rankTargets(targets, new Set((inbox?.requests ?? []).map((r) => r.subject.id)), recent),
    [targets, inbox?.requests, recent],
  );
  const initial = targets.find((t) => t.person.id === preselect);
  const [personId, setPersonId] = useState<string | null>(initial?.person.id ?? null);
  const [activityId, setActivityId] = useState<ActivityId | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<InteractionKind>('client_meeting');
  const [when, setWhen] = useState<When>('today');
  const [earlier, setEarlier] = useState(daysAgoIso(2));
  const [skillRefs, setSkillRefs] = useState<ReadonlyArray<SkillRef>>(firstSkills(initial));
  const [draft, setDraft] = useState<Draft>(() => ({
    mode: 'saw_it',
    ratings: firstSkills(initial).map((s) => emptyRating(s.id)),
    narrativeSaw: '',
    narrativeNext: '',
  }));
  const started = useRef<{ id: ObservationId; version: number } | null>(null);
  const [locked, setLocked] = useState(false);

  const target = targets.find((t) => t.person.id === personId);
  const activity = target?.activities.find((a) => a.id === activityId);
  const occurredOn = { today: todayIso(), yesterday: daysAgoIso(1), earlier }[when];
  const outsideWindow = occurredOn < daysAgoIso(OBSERVE_WINDOW_DAYS) || occurredOn > todayIso();
  const privacy = screenLocally(`${draft.narrativeSaw}\n${draft.narrativeNext}`);

  // Each rated skill's own ladder: the level descriptors sit inside the picker.
  const ladders = useQueries({
    queries: skillRefs.map((s) => ({
      ...queryOptions('catalog', 'skill', { params: { slug: s.slug } }),
      staleTime: 5 * 60_000,
    })),
  });
  const levelsOf = (id: SkillId) =>
    ladders[skillRefs.findIndex((s) => s.id === id)]?.data?.levels ?? [];
  const nameOf = (id: string) => skillRefs.find((s) => s.id === id)?.name ?? 'Skill';

  const suggestions = useMemo(() => {
    const all = [...(target?.focusSkills ?? []), ...(activity?.targetSkills ?? [])];
    return [...new Map(all.map((s) => [s.id, s])).values()];
  }, [target, activity]);

  const choosePerson = (t: ObserveTarget) => {
    if (locked) return;
    setPersonId(t.person.id);
    setActivityId(null);
    const skills = firstSkills(t);
    setSkillRefs(skills);
    setDraft((d) => ({ ...d, ratings: skills.map((s) => emptyRating(s.id)) }));
  };

  const removeSkill = (id: SkillId) => {
    setSkillRefs((refs) => refs.filter((s) => s.id !== id));
    setDraft((d) => ({ ...d, ratings: d.ratings.filter((r) => r.skillId !== id) }));
  };

  const toggleSkill = (skill: SkillRef) => {
    if (draft.ratings.some((r) => r.skillId === skill.id)) return removeSkill(skill.id);
    if (draft.ratings.length >= MAX_SKILLS_PER_OBSERVATION) return undefined;
    setSkillRefs((refs) => [...refs.filter((s) => s.id !== skill.id), skill]);
    setDraft((d) => ({ ...d, ratings: [...d.ratings, emptyRating(skill.id)] }));
    return undefined;
  };

  const ensureDraft = async () => {
    if (started.current) return started.current;
    if (!target) throw new Error('No one chosen');
    const view = await call('observations', 'start', {
      payload: {
        subjectId: target.person.id,
        activityId: activity ? activity.id : null,
        // Unnamed work: the server names it after the kind.
        title: activity ? null : title.trim() || null,
        occurredOn: occurredOn as IsoDate,
        kind,
        mode: draft.mode,
        skillIds: draft.ratings.map((r) => r.skillId),
      },
    });
    started.current = { id: view.id, version: view.version };
    setLocked(true);
    rememberRecent(target.person.id);
    return started.current;
  };

  /** Writes the current words to the observer-only draft (creating it first if needed). */
  const saveDraft = async () => {
    const { id, version } = await ensureDraft();
    const saved = await call('observations', 'saveDraft', {
      params: { id },
      payload: toPayload(draft, version, new Set()),
    });
    started.current = { id, version: saved.version };
    await qc.invalidateQueries();
    return saved;
  };

  const sign = async (): Promise<ObservationView> => {
    const { id, version } = await ensureDraft();
    try {
      const signed = await call('observations', 'sign', {
        params: { id },
        payload: toPayload(draft, version, new Set()),
      });
      await qc.invalidateQueries();
      return signed;
    } catch (error) {
      // Not signed: keep the observer's words in their draft so nothing is lost.
      await saveDraft().catch(() => undefined);
      throw error;
    }
  };

  return {
    people,
    target,
    activity,
    activityId,
    setActivityId,
    title,
    setTitle,
    kind,
    setKind,
    when,
    setWhen,
    earlier,
    setEarlier,
    occurredOn,
    outsideWindow,
    privacy,
    draft,
    setDraft,
    suggestions,
    levelsOf,
    nameOf,
    choosePerson,
    toggleSkill,
    removeSkill,
    locked,
    missing: blocker(target, outsideWindow, privacy.held, draft),
    canSaveForLater: !!target && !outsideWindow && draft.ratings.length > 0,
    saveDraft,
    sign,
  };
};

export type QuickCapture = ReturnType<typeof useQuickCapture>;
