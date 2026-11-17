import type {
  InboxView,
  ObservationView,
  ObserveTarget,
  ObserveTargets,
  SkillRef,
  StartObservationInput,
  WorkSkill,
} from '@repo/api';
import {
  OBSERVE_WINDOW_DAYS,
  resolveRatingRoles,
  screenLocally,
  type ActivityId,
  type InteractionId,
  type InteractionKind,
  type IsoDate,
  type ObservationId,
  type SkillId,
  type SkillRole,
} from '@repo/domain';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { call, isApiError, queryOptions } from '@/lib/api.ts';
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
  const first = target?.focusSkills[0] ?? target?.activities[0]?.skills[0]?.skill;
  return first ? [first] : [];
};

/** Its role is resolved from the work and the observer's choices (`resolveRatingRoles`). */
const emptyRating = (skillId: SkillId): DraftRating => ({
  skillId,
  level: null,
  indicatorIds: [],
  credit: true,
  role: 'secondary',
});

/** The skills of a piece of work, the work's own first (primary first). */
const skillsOfWork = (skills: ReadonlyArray<WorkSkill>): ReadonlyArray<SkillRef> =>
  skills.map((s) => s.skill);

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
 * Each rating's role: the observer's choice, else the work's default, else
 * secondary (the first is primary when the work names none), by the same rule
 * the server applies (`resolveRatingRoles`).
 */
const withResolvedRoles = (
  draft: Draft,
  listed: ReadonlyArray<WorkSkill>,
  chosen: ReadonlyMap<SkillId, SkillRole>,
): Draft => {
  const resolved = resolveRatingRoles(
    listed.map((s) => ({ skillId: s.skill.id, role: s.role })),
    draft.ratings.map((r) => ({ skillId: r.skillId, chosen: chosen.get(r.skillId) })),
  );
  // `chooseRole` never stores two primaries; keep the ratings as they are if it ever did.
  if (!resolved.ok) return draft;
  return {
    ...draft,
    ratings: draft.ratings.map((r, i) => ({ ...r, role: resolved.roles[i] ?? r.role })),
  };
};

/** The observer's choices after one change: making one skill primary makes any other secondary. */
const chooseRoleIn = (draft: Draft, skillId: SkillId, role: SkillRole) => {
  const next = new Map<SkillId, SkillRole>(draft.ratings.map((r) => [r.skillId, r.role] as const));
  if (role === 'primary')
    for (const [id, r] of next) if (r === 'primary') next.set(id, 'secondary');
  next.set(skillId, role);
  return next;
};

/**
 * The capture's writes. Nothing is written until the observer signs or saves
 * for later; after that first write the same observer-only draft is reused, so
 * a retry never starts a second one.
 */
const useCaptureWrites = (
  startInput: () => StartObservationInput | null,
  draft: Draft,
  onStarted: () => void,
  onAttachRefused: () => void,
) => {
  const qc = useQueryClient();
  const started = useRef<{ id: ObservationId; version: number } | null>(null);

  const ensureDraft = async () => {
    if (started.current) return started.current;
    const payload = startInput();
    if (!payload) throw new Error('No one chosen');
    const view = await call('observations', 'start', { payload }).catch(async (error: unknown) => {
      // The logged work is no longer offered (observed meanwhile, or out of reach):
      // drop the stale choice and show the current list, then report the refusal.
      if (
        payload.interactionId &&
        isApiError(error) &&
        ['Conflict', 'NotFound'].includes(error._tag)
      ) {
        onAttachRefused();
        await qc.invalidateQueries({ queryKey: ['observations', 'targets'] });
      }
      throw error;
    });
    started.current = { id: view.id, version: view.version };
    rememberRecent(payload.subjectId);
    onStarted();
    return started.current;
  };

  /** Writes the current words to the observer-only draft (creating it first if needed). */
  const saveDraft = async () => {
    const { id, version } = await ensureDraft();
    const saved = await call('observations', 'saveDraft', {
      params: { id },
      payload: toPayload(draft, version),
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
        payload: toPayload(draft, version),
      });
      await qc.invalidateQueries();
      return signed;
    } catch (error) {
      // Not signed: keep the observer's words in their draft so nothing is lost.
      await saveDraft().catch(() => undefined);
      throw error;
    }
  };

  return { saveDraft, sign };
};

/** Each rated skill's own ladder: the level descriptors sit inside the picker. */
const useLadders = (skillRefs: ReadonlyArray<SkillRef>) => {
  const ladders = useQueries({
    queries: skillRefs.map((s) => ({
      ...queryOptions('catalog', 'skill', { params: { slug: s.slug } }),
      staleTime: 5 * 60_000,
    })),
  });
  return {
    levelsOf: (id: SkillId) => ladders[skillRefs.findIndex((s) => s.id === id)]?.data?.levels ?? [],
    nameOf: (id: string) => skillRefs.find((s) => s.id === id)?.name ?? 'Skill',
  };
};

/**
 * State for the one-screen capture: who, when, which work (new or already
 * logged), the skills with their roles, and the words. Nothing is written until
 * the observer signs or saves for later (`useCaptureWrites`).
 */
export const useQuickCapture = (
  { people: targets, maxSkills }: ObserveTargets,
  inbox: InboxView | undefined,
  preselect: string | undefined,
) => {
  const [recent] = useState(readRecent);
  const people = useMemo(
    () => rankTargets(targets, new Set((inbox?.requests ?? []).map((r) => r.subject.id)), recent),
    [targets, inbox?.requests, recent],
  );
  const initial = targets.find((t) => t.person.id === preselect);
  const [personId, setPersonId] = useState<string | null>(initial?.person.id ?? null);
  const [activityId, setActivityId] = useState<ActivityId | null>(null);
  /** Work the person already logged that this observation attaches to (design §9). */
  const [workId, setWorkId] = useState<InteractionId | null>(null);
  /** Roles the observer chose; the rest default from the work (they own them, design §4). */
  const [chosenRoles, setChosenRoles] = useState<ReadonlyMap<SkillId, SkillRole>>(new Map());
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
  const [locked, setLocked] = useState(false);

  const target = targets.find((t) => t.person.id === personId);
  const activity = target?.activities.find((a) => a.id === activityId);
  const chosenDay = { today: todayIso(), yesterday: daysAgoIso(1), earlier }[when];
  // Work the person logged that day, which "I saw this" can attach to instead.
  const loggedThatDay = (target?.work ?? []).filter((w) => w.occurredOn === chosenDay);
  const work = loggedThatDay.find((w) => w.id === workId);
  const occurredOn = work?.occurredOn ?? chosenDay;
  const listed = work?.skills ?? activity?.skills ?? [];
  const effective = withResolvedRoles(draft, listed, chosenRoles);
  const outsideWindow = occurredOn < daysAgoIso(OBSERVE_WINDOW_DAYS) || occurredOn > todayIso();
  const privacy = screenLocally(`${draft.narrativeSaw}\n${draft.narrativeNext}`);
  const full = draft.ratings.length >= maxSkills;

  const { levelsOf, nameOf } = useLadders(skillRefs);

  const suggestions = [
    ...new Map(
      [...skillsOfWork(listed), ...(target?.focusSkills ?? [])].map((s) => [s.id, s]),
    ).values(),
  ];

  /** Starts the skills afresh from a piece of work (or the person's first skill). */
  const resetSkills = (skills: ReadonlyArray<SkillRef>) => {
    const first = skills.slice(0, Math.max(1, Math.min(skills.length, maxSkills)));
    setSkillRefs(first);
    setChosenRoles(new Map());
    setDraft((d) => ({ ...d, ratings: first.map((s) => emptyRating(s.id)) }));
  };

  const choosePerson = (t: ObserveTarget) => {
    if (locked) return;
    setPersonId(t.person.id);
    setActivityId(null);
    setWorkId(null);
    resetSkills(firstSkills(t));
  };

  const chooseActivity = (id: ActivityId | null) => {
    if (locked) return;
    setActivityId(id);
    const chosen = target?.activities.find((a) => a.id === id);
    if (chosen && chosen.skills.length > 0) resetSkills(skillsOfWork(chosen.skills));
  };

  /** Attach to work already logged that day, or (null) describe new work. */
  const chooseWork = (id: InteractionId | null) => {
    if (locked) return;
    setWorkId(id);
    const chosen = target?.work.find((w) => w.id === id);
    if (chosen && chosen.skills.length > 0) resetSkills(skillsOfWork(chosen.skills));
  };

  const chooseWhen = (next: When) => {
    if (locked) return;
    setWhen(next);
    setWorkId(null);
  };
  const chooseEarlier = (day: string) => {
    if (locked) return;
    setEarlier(day);
    setWorkId(null);
  };

  const chooseRole = (skillId: SkillId, role: SkillRole) =>
    setChosenRoles(chooseRoleIn(effective, skillId, role));

  const removeSkill = (id: SkillId) => {
    setSkillRefs((refs) => refs.filter((s) => s.id !== id));
    setDraft((d) => ({ ...d, ratings: d.ratings.filter((r) => r.skillId !== id) }));
  };

  const toggleSkill = (skill: SkillRef) => {
    if (draft.ratings.some((r) => r.skillId === skill.id)) return removeSkill(skill.id);
    if (full) return undefined;
    setSkillRefs((refs) => [...refs.filter((s) => s.id !== skill.id), skill]);
    setDraft((d) => ({ ...d, ratings: [...d.ratings, emptyRating(skill.id)] }));
    return undefined;
  };

  const { saveDraft, sign } = useCaptureWrites(
    () =>
      target
        ? {
            subjectId: target.person.id,
            // Attached to logged work: the server takes its date and kind.
            interactionId: work ? work.id : null,
            activityId: !work && activity ? activity.id : null,
            // Unnamed work: the server names it after the kind.
            title: work || activity ? null : title.trim() || null,
            occurredOn: occurredOn as IsoDate,
            kind: work ? work.kind : kind,
            mode: draft.mode,
            skillIds: draft.ratings.map((r) => r.skillId),
          }
        : null,
    effective,
    () => setLocked(true),
    () => setWorkId(null),
  );

  return {
    people,
    target,
    activity,
    activityId,
    chooseActivity,
    loggedThatDay,
    work,
    chooseWork,
    title,
    setTitle,
    kind,
    setKind,
    when,
    chooseWhen,
    earlier,
    chooseEarlier,
    occurredOn,
    outsideWindow,
    privacy,
    /** The draft with each rating's resolved role. */
    draft: effective,
    setDraft,
    chooseRole,
    maxSkills,
    full,
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
