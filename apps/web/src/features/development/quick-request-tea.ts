import type { ObservationView } from '@repo/api';
import {
  screenLocally,
  type InteractionKind,
  type ObservationMode,
  type PersonId,
  type SkillId,
} from '@repo/domain';
import { Effect, Match } from 'effect';
import { daysAgoIso, todayIso } from '@/lib/format.ts';
import { pure, withCommands, type Command, type UpdateResult } from '@/lib/foldkit.ts';

export type RequestWhen = 'today' | 'yesterday' | 'pick';

export interface QuickRequestModel {
  readonly observerId: PersonId | null;
  readonly chosenSkills: ReadonlyArray<SkillId> | null;
  readonly kind: InteractionKind;
  readonly title: string;
  readonly when: RequestWhen;
  readonly pickedDate: string;
  readonly mode: ObservationMode;
  readonly note: string;
  readonly submitting: boolean;
  readonly error: string | null;
}

export type QuickRequestMsg =
  | { readonly _tag: 'SelectObserver'; readonly observerId: PersonId }
  | {
      readonly _tag: 'ToggleSkill';
      readonly skillId: SkillId;
      readonly current: ReadonlyArray<SkillId>;
    }
  | { readonly _tag: 'SetKind'; readonly kind: InteractionKind }
  | { readonly _tag: 'SetTitle'; readonly title: string }
  | { readonly _tag: 'SetWhen'; readonly when: RequestWhen }
  | { readonly _tag: 'SetPickedDate'; readonly date: string }
  | { readonly _tag: 'SetMode'; readonly mode: ObservationMode }
  | { readonly _tag: 'SetNote'; readonly note: string }
  | { readonly _tag: 'Submit'; readonly command: Command<QuickRequestMsg> }
  | { readonly _tag: 'Submitted'; readonly view: ObservationView }
  | { readonly _tag: 'Failed'; readonly message: string }
  | { readonly _tag: 'Reset' };

export const initialQuickRequestModel = (): QuickRequestModel => ({
  observerId: null,
  chosenSkills: null,
  kind: 'client_meeting',
  title: '',
  when: 'today',
  pickedDate: todayIso(),
  mode: 'saw_it',
  note: '',
  submitting: false,
  error: null,
});

export const quickRequestOccurredOn = (m: QuickRequestModel): string =>
  ({ today: todayIso(), yesterday: daysAgoIso(1), pick: m.pickedDate })[m.when];

export const quickRequestPrivacy = (m: QuickRequestModel) =>
  m.note.trim().length > 0 ? screenLocally(m.note) : { held: false, reasons: [] as const };

/**
 * Pure Foldkit/TEA update function for "Ask for feedback".
 * Exhaustively matches every tagged Message with Effect's `Match`.
 */
export const updateQuickRequest = (
  model: QuickRequestModel,
  msg: QuickRequestMsg,
): UpdateResult<QuickRequestModel, QuickRequestMsg> =>
  Match.value(msg).pipe(
    Match.tag('SelectObserver', ({ observerId }) => pure({ ...model, observerId, error: null })),
    Match.tag('ToggleSkill', ({ skillId, current }) => {
      const next = current.includes(skillId)
        ? current.filter((x) => x !== skillId)
        : [...current, skillId].slice(0, 3);
      return pure({ ...model, chosenSkills: next, error: null });
    }),
    Match.tag('SetKind', ({ kind }) => pure({ ...model, kind })),
    Match.tag('SetTitle', ({ title }) => pure({ ...model, title })),
    Match.tag('SetWhen', ({ when }) => pure({ ...model, when })),
    Match.tag('SetPickedDate', ({ date }) => pure({ ...model, pickedDate: date })),
    Match.tag('SetMode', ({ mode }) => pure({ ...model, mode })),
    Match.tag('SetNote', ({ note }) => pure({ ...model, note, error: null })),
    Match.tag('Submit', ({ command }) =>
      model.submitting
        ? pure(model)
        : withCommands({ ...model, submitting: true, error: null }, command),
    ),
    Match.tag('Submitted', () => pure(initialQuickRequestModel())),
    Match.tag('Failed', ({ message }) => pure({ ...model, submitting: false, error: message })),
    Match.tag('Reset', () => pure(initialQuickRequestModel())),
    Match.exhaustive,
  );

/** Helper for building an Effect command that turns API success/failure into TEA messages. */
export const submitCommand = (
  effect: Effect.Effect<ObservationView, unknown>,
  onSuccess: (view: ObservationView) => void,
  describe: (error: unknown) => string,
): Command<QuickRequestMsg> =>
  effect.pipe(
    Effect.tap((view) => Effect.sync(() => onSuccess(view))),
    Effect.map((view): QuickRequestMsg => ({ _tag: 'Submitted', view })),
    Effect.catch((error) =>
      Effect.succeed<QuickRequestMsg>({ _tag: 'Failed', message: describe(error) }),
    ),
  );
