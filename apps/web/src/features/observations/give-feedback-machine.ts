import type { ObservationView, ObserveTarget, SkillRef } from '@repo/api';
import {
  MAX_SKILLS_PER_OBSERVATION,
  MIN_NARRATIVE_LENGTH,
  OBSERVE_WINDOW_DAYS,
  screenLocally,
  type ActivityId,
  type InteractionKind,
  type IsoDate,
  type Level,
  type ObservationMode,
  type SkillId,
  type SkillIndicatorId,
} from '@repo/domain';
import { assign, setup } from 'xstate';
import { daysAgoIso, todayIso } from '@/lib/format.ts';

export type When = 'today' | 'yesterday' | 'earlier';

export interface FeedbackRating {
  readonly skillId: SkillId;
  readonly level: Level | null;
  readonly indicatorIds: ReadonlyArray<SkillIndicatorId>;
  readonly credit: boolean;
}

export interface GiveFeedbackContext {
  readonly target: ObserveTarget | null;
  readonly activityId: ActivityId | null;
  readonly title: string;
  readonly kind: InteractionKind;
  readonly when: When;
  readonly earlier: string;
  readonly mode: ObservationMode;
  readonly skillRefs: ReadonlyArray<SkillRef>;
  readonly ratings: ReadonlyArray<FeedbackRating>;
  readonly narrativeSaw: string;
  readonly narrativeNext: string;
  readonly error: string | null;
  readonly published: ObservationView | null;
}

export type GiveFeedbackEvent =
  | { readonly type: 'CHOOSE_PERSON'; readonly target: ObserveTarget }
  | { readonly type: 'SET_ACTIVITY'; readonly activityId: ActivityId | null }
  | { readonly type: 'SET_TITLE'; readonly title: string }
  | { readonly type: 'SET_KIND'; readonly kind: InteractionKind }
  | { readonly type: 'SET_WHEN'; readonly when: When }
  | { readonly type: 'SET_EARLIER'; readonly date: string }
  | { readonly type: 'SET_MODE'; readonly mode: ObservationMode }
  | { readonly type: 'TOGGLE_SKILL'; readonly skill: SkillRef }
  | { readonly type: 'REMOVE_SKILL'; readonly skillId: SkillId }
  | { readonly type: 'UPDATE_RATING'; readonly rating: FeedbackRating }
  | { readonly type: 'SET_SAW'; readonly value: string }
  | { readonly type: 'SET_NEXT'; readonly value: string }
  | { readonly type: 'PUBLISH' }
  | { readonly type: 'SAVE_DRAFT' }
  | { readonly type: 'PUBLISHED'; readonly view: ObservationView }
  | { readonly type: 'DRAFT_SAVED' }
  | { readonly type: 'FAILED'; readonly message: string }
  | { readonly type: 'RESET' };

const defaultSkillsFor = (target: ObserveTarget | null): ReadonlyArray<SkillRef> => {
  const first = target?.focusSkills[0] ?? target?.activities[0]?.targetSkills[0];
  return first ? [first] : [];
};

const emptyRating = (skillId: SkillId): FeedbackRating => ({
  skillId,
  level: null,
  indicatorIds: [],
  credit: true,
});

export const occurredOnOf = (ctx: Pick<GiveFeedbackContext, 'when' | 'earlier'>): IsoDate =>
  ({ today: todayIso(), yesterday: daysAgoIso(1), earlier: ctx.earlier })[ctx.when] as IsoDate;

export const isOutsideWindow = (occurredOn: string): boolean =>
  occurredOn < daysAgoIso(OBSERVE_WINDOW_DAYS) || occurredOn > todayIso();

export const privacyOf = (ctx: Pick<GiveFeedbackContext, 'narrativeSaw' | 'narrativeNext'>) =>
  screenLocally(`${ctx.narrativeSaw}\n${ctx.narrativeNext}`);

/** Explains the single thing still needed before publishing, or null when ready. */
export const missingToPublish = (ctx: GiveFeedbackContext): string | null => {
  if (!ctx.target) return 'Choose who you observed';
  if (isOutsideWindow(occurredOnOf(ctx))) {
    return `Choose a date within the last ${OBSERVE_WINDOW_DAYS} days`;
  }
  if (ctx.ratings.length === 0) return 'Choose at least one skill';
  if (ctx.ratings.some((r) => r.level === null)) return 'Pick a level for each skill';
  if (ctx.narrativeSaw.trim().length < MIN_NARRATIVE_LENGTH) {
    const left = MIN_NARRATIVE_LENGTH - ctx.narrativeSaw.trim().length;
    return `Add ${left} more ${left === 1 ? 'character' : 'characters'} about what you saw`;
  }
  if (privacyOf(ctx).held) return 'Remove client names or account details to publish';
  return null;
};

export const canSaveDraft = (ctx: GiveFeedbackContext): boolean =>
  ctx.target !== null && !isOutsideWindow(occurredOnOf(ctx)) && ctx.ratings.length > 0;

const initialContext = (initialTarget: ObserveTarget | null): GiveFeedbackContext => {
  const skills = defaultSkillsFor(initialTarget);
  return {
    target: initialTarget,
    activityId: null,
    title: '',
    kind: 'client_meeting',
    when: 'today',
    earlier: daysAgoIso(2),
    mode: 'saw_it',
    skillRefs: skills,
    ratings: skills.map((s) => emptyRating(s.id)),
    narrativeSaw: '',
    narrativeNext: '',
    error: null,
    published: null,
  };
};

/**
 * XState 5 workflow machine for "Give feedback" (`/observations/new`).
 * Makes double-submits, publishing while privacy-held, or losing text on error
 * structurally impossible. Pure and 100% unit-testable without React.
 */
export const createGiveFeedbackMachine = (initialTarget: ObserveTarget | null = null) =>
  setup({
    types: {
      context: {} as GiveFeedbackContext,
      events: {} as GiveFeedbackEvent,
    },
    guards: {
      readyToPublish: ({ context }) => missingToPublish(context) === null,
      draftable: ({ context }) => canSaveDraft(context),
    },
    actions: {
      choosePerson: assign(({ event }) => {
        if (event.type !== 'CHOOSE_PERSON') return {};
        const skills = defaultSkillsFor(event.target);
        return {
          target: event.target,
          activityId: null,
          skillRefs: skills,
          ratings: skills.map((s) => emptyRating(s.id)),
          error: null,
        };
      }),
      toggleSkill: assign(({ context, event }) => {
        if (event.type !== 'TOGGLE_SKILL') return {};
        const exists = context.ratings.some((r) => r.skillId === event.skill.id);
        if (exists) {
          return {
            skillRefs: context.skillRefs.filter((s) => s.id !== event.skill.id),
            ratings: context.ratings.filter((r) => r.skillId !== event.skill.id),
          };
        }
        if (context.ratings.length >= MAX_SKILLS_PER_OBSERVATION) return {};
        return {
          skillRefs: [...context.skillRefs.filter((s) => s.id !== event.skill.id), event.skill],
          ratings: [...context.ratings, emptyRating(event.skill.id)],
        };
      }),
      removeSkill: assign(({ context, event }) => {
        if (event.type !== 'REMOVE_SKILL') return {};
        return {
          skillRefs: context.skillRefs.filter((s) => s.id !== event.skillId),
          ratings: context.ratings.filter((r) => r.skillId !== event.skillId),
        };
      }),
      updateRating: assign(({ context, event }) => {
        if (event.type !== 'UPDATE_RATING') return {};
        return {
          ratings: context.ratings.map((r) =>
            r.skillId === event.rating.skillId ? event.rating : r,
          ),
        };
      }),
    },
  }).createMachine({
    id: 'giveFeedback',
    initial: 'editing',
    context: initialContext(initialTarget),
    states: {
      editing: {
        on: {
          CHOOSE_PERSON: { actions: 'choosePerson' },
          SET_ACTIVITY: {
            actions: assign(({ event }) => ({ activityId: event.activityId })),
          },
          SET_TITLE: { actions: assign(({ event }) => ({ title: event.title })) },
          SET_KIND: { actions: assign(({ event }) => ({ kind: event.kind })) },
          SET_WHEN: { actions: assign(({ event }) => ({ when: event.when })) },
          SET_EARLIER: { actions: assign(({ event }) => ({ earlier: event.date })) },
          SET_MODE: { actions: assign(({ event }) => ({ mode: event.mode })) },
          TOGGLE_SKILL: { actions: 'toggleSkill' },
          REMOVE_SKILL: { actions: 'removeSkill' },
          UPDATE_RATING: { actions: 'updateRating' },
          SET_SAW: { actions: assign(({ event }) => ({ narrativeSaw: event.value, error: null })) },
          SET_NEXT: {
            actions: assign(({ event }) => ({ narrativeNext: event.value, error: null })),
          },
          PUBLISH: {
            guard: 'readyToPublish',
            target: 'publishing',
            actions: assign({ error: null }),
          },
          SAVE_DRAFT: {
            guard: 'draftable',
            target: 'savingDraft',
            actions: assign({ error: null }),
          },
          RESET: { actions: assign(() => initialContext(null)) },
        },
      },
      publishing: {
        on: {
          PUBLISHED: {
            target: 'published',
            actions: assign(({ event }) => ({ published: event.view, error: null })),
          },
          FAILED: {
            target: 'editing',
            actions: assign(({ event }) => ({ error: event.message })),
          },
        },
      },
      savingDraft: {
        on: {
          DRAFT_SAVED: { target: 'editing', actions: assign({ error: null }) },
          FAILED: {
            target: 'editing',
            actions: assign(({ event }) => ({ error: event.message })),
          },
        },
      },
      published: {
        on: {
          RESET: { target: 'editing', actions: assign(() => initialContext(null)) },
        },
      },
    },
  });
