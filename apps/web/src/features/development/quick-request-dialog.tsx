import type { EligibleObserverSummary, SkillRef } from '@repo/api';
import {
  INTERACTION_KINDS,
  LOG_WINDOW_DAYS,
  OBSERVATION_MODES,
  screenLocally,
  type InteractionKind,
  type ObservationMode,
  type PersonId,
  type SkillId,
} from '@repo/domain';
import {
  AssistantNote,
  Button,
  cn,
  Field,
  FieldHint,
  Input,
  Label,
  PersonAvatar,
  SegmentedControl,
  SegmentedItem,
  Skeleton,
  Textarea,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { useLogDialog } from '@/components/shell/log-dialog-context.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';
import { daysAgoIso, kindLabel, todayIso } from '@/lib/format.ts';
import { BASIS_LABEL } from '@/lib/lifecycle-presentation.ts';

type When = 'today' | 'yesterday' | 'pick';

const MODE_LABELS: Record<ObservationMode, string> = {
  saw_it: 'They were there',
  reviewed_work: 'Reviewing recording / work',
  discussed: 'We’ll debrief it',
};

const QUICK_KINDS: ReadonlyArray<InteractionKind> = [
  'client_meeting',
  'prospect_meeting',
  'book_review',
  'presentation',
  'team_conversation',
];

const pickDefaultSkills = (
  preselected: string | null,
  focusSkills: ReadonlyArray<SkillRef>,
  allSkills: ReadonlyArray<{ id: SkillId }>,
): ReadonlyArray<SkillId> => {
  if (preselected) return [preselected as SkillId];
  if (focusSkills[0]) return [focusSkills[0].id];
  if (allSkills[0]) return [allSkills[0].id];
  return [];
};

const ObserverCards = ({
  observers,
  activeId,
  onSelect,
}: {
  readonly observers: ReadonlyArray<EligibleObserverSummary>;
  readonly activeId: PersonId | null;
  readonly onSelect: (id: PersonId) => void;
}) => (
  <fieldset className="grid gap-2">
    <legend className="text-ui font-medium text-ink">Who can give feedback?</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      {observers.map((o) => {
        const selected = activeId === o.person.id;
        return (
          <button
            key={o.person.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(o.person.id)}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-card border px-3 py-2.5 text-left transition-colors',
              selected
                ? 'border-primary bg-primary-soft/50 ring-1 ring-primary/30'
                : 'border-line bg-surface hover:bg-sunken',
            )}
          >
            <PersonAvatar person={o.person} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui font-medium text-ink">
                {o.person.displayName}
              </span>
              <span className="block text-meta text-ink-3">{BASIS_LABEL[o.basis]}</span>
            </span>
            {selected ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
          </button>
        );
      })}
    </div>
  </fieldset>
);

const SkillPill = ({
  name,
  on,
  onClick,
}: {
  readonly name: string;
  readonly on: boolean;
  readonly onClick: () => void;
}) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={cn(
      'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-ui transition-colors',
      on
        ? 'border-primary bg-primary-soft font-medium text-primary-ink'
        : 'border-line bg-surface text-ink-2 hover:bg-sunken',
    )}
  >
    {on ? <CheckIcon className="size-3.5" aria-hidden /> : null}
    {name}
  </button>
);

const SkillSelector = ({
  focusSkills,
  allSkills,
  selected,
  onToggle,
}: {
  readonly focusSkills: ReadonlyArray<SkillRef>;
  readonly allSkills: ReadonlyArray<SkillRef>;
  readonly selected: ReadonlyArray<SkillId>;
  readonly onToggle: (id: SkillId) => void;
}) => {
  const [showAll, setShowAll] = useState(false);
  const focusIds = new Set(focusSkills.map((s) => s.id));
  const primary = focusSkills.length > 0 ? focusSkills : allSkills;
  const extras = focusSkills.length > 0 ? allSkills.filter((s) => !focusIds.has(s.id)) : [];
  return (
    <Field>
      <Label>Which skill? (up to 3)</Label>
      <div className="flex flex-wrap gap-1.5">
        {primary.map((s) => (
          <SkillPill
            key={s.id}
            name={s.name}
            on={selected.includes(s.id)}
            onClick={() => onToggle(s.id)}
          />
        ))}
        {extras.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-dashed border-line-strong px-3 text-meta text-ink-3 hover:bg-sunken hover:text-ink"
          >
            {showAll ? 'Less skills' : 'All skills'}
            <ChevronDownIcon
              className={cn('size-3.5 transition-transform', showAll && 'rotate-180')}
            />
          </button>
        ) : null}
      </div>
      {showAll && extras.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {extras.map((s) => (
            <SkillPill
              key={s.id}
              name={s.name}
              on={selected.includes(s.id)}
              onClick={() => onToggle(s.id)}
            />
          ))}
        </div>
      ) : null}
    </Field>
  );
};

const WorkContextFields = ({
  kind,
  onKind,
  title,
  onTitle,
  when,
  onWhen,
  pickedDate,
  onPickedDate,
}: {
  readonly kind: InteractionKind;
  readonly onKind: (k: InteractionKind) => void;
  readonly title: string;
  readonly onTitle: (t: string) => void;
  readonly when: When;
  readonly onWhen: (w: When) => void;
  readonly pickedDate: string;
  readonly onPickedDate: (d: string) => void;
}) => (
  <Field>
    <Label>What was the work?</Label>
    <div className="flex flex-wrap gap-1.5">
      {QUICK_KINDS.filter((k) => INTERACTION_KINDS.includes(k)).map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={kind === k}
          onClick={() => onKind(k)}
          className={cn(
            'inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-ui transition-colors',
            kind === k
              ? 'border-primary bg-primary-soft font-medium text-primary-ink'
              : 'border-line bg-surface text-ink-2 hover:bg-sunken',
          )}
        >
          {kindLabel(k)}
        </button>
      ))}
    </div>
    <div className="mt-1.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <Input
        aria-label="Short title (optional)"
        placeholder="Optional label, e.g. Retirement discovery call"
        value={title}
        maxLength={120}
        onChange={(e) => onTitle(e.target.value)}
      />
      <SegmentedControl
        type="single"
        value={when}
        onValueChange={(v) => v && onWhen(v as When)}
        aria-label="When"
      >
        <SegmentedItem value="today">Today</SegmentedItem>
        <SegmentedItem value="yesterday">Yesterday</SegmentedItem>
        <SegmentedItem value="pick">Date</SegmentedItem>
      </SegmentedControl>
    </div>
    {when === 'pick' ? (
      <Input
        type="date"
        aria-label="Date of work"
        min={daysAgoIso(LOG_WINDOW_DAYS)}
        max={todayIso()}
        value={pickedDate}
        onChange={(e) => onPickedDate(e.target.value)}
        className="mt-1.5 w-44"
      />
    ) : null}
  </Field>
);

const NoObserversBody = ({ onClose }: { readonly onClose: () => void }) => (
  <div className="grid gap-4">
    <p className="text-body text-ink-2">
      You don’t have a leader or coach linked yet. Find a coach in People to start getting feedback
      on your client work.
    </p>
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>
        Close
      </Button>
      <Button variant="primary" asChild onClick={onClose}>
        <Link to="/people">Find a coach</Link>
      </Button>
    </div>
  </div>
);

const ModeAndNoteFields = ({
  mode,
  onMode,
  note,
  onNote,
  privacy,
}: {
  readonly mode: ObservationMode;
  readonly onMode: (m: ObservationMode) => void;
  readonly note: string;
  readonly onNote: (n: string) => void;
  readonly privacy: { readonly held: boolean; readonly reasons: ReadonlyArray<string> };
}) => (
  <>
    <Field>
      <Label>How did they see it?</Label>
      <SegmentedControl
        type="single"
        value={mode}
        onValueChange={(v) => v && onMode(v as ObservationMode)}
        className="flex-wrap"
      >
        {OBSERVATION_MODES.map((m) => (
          <SegmentedItem key={m} value={m}>
            {MODE_LABELS[m]}
          </SegmentedItem>
        ))}
      </SegmentedControl>
    </Field>
    <Field>
      <Label htmlFor="quick-req-note">Note for them · optional</Label>
      <Textarea
        id="quick-req-note"
        rows={2}
        value={note}
        onChange={(e) => onNote(e.target.value)}
        placeholder="e.g. Tried pausing before showing numbers — curious how that landed."
      />
      <FieldHint>Describe what you did — no client names or account numbers.</FieldHint>
      {privacy.held ? (
        <AssistantNote>
          This appears to include client details ({privacy.reasons.join('; ').toLowerCase()}).
          Remove them before sending.
        </AssistantNote>
      ) : null}
    </Field>
  </>
);

/**
 * Unified one-step "Ask for feedback" dialog backed by POST /observations/request-quick.
 */
export const QuickRequestDialog = () => {
  const dialog = useLogDialog();
  const observersQuery = useQuery({
    ...queryOptions('observations', 'observers', undefined),
    enabled: dialog.open,
  });
  const devQuery = useQuery({
    ...queryOptions('development', 'mine', undefined),
    enabled: dialog.open,
  });
  const catalogQuery = useQuery({
    ...queryOptions('catalog', 'skills', { query: {} }),
    enabled: dialog.open,
  });

  const observers = observersQuery.data ?? [];
  const focusSkills = (devQuery.data?.plan?.focusSkills ?? []).map((f) => f.skill);
  const allSkills: ReadonlyArray<SkillRef> = (catalogQuery.data ?? []).map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    domain: s.domain,
  }));

  const [observerId, setObserverId] = useState<PersonId | null>(null);
  const [chosenSkills, setChosenSkills] = useState<ReadonlyArray<SkillId> | null>(null);
  const [kind, setKind] = useState<InteractionKind>('client_meeting');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<When>('today');
  const [pickedDate, setPickedDate] = useState(todayIso());
  const [mode, setMode] = useState<ObservationMode>('saw_it');
  const [note, setNote] = useState('');

  const activeObserver = observerId ?? observers[0]?.person.id ?? null;
  const selectedSkills = chosenSkills ?? pickDefaultSkills(dialog.skillId, focusSkills, allSkills);
  const toggleSkill = (id: SkillId) =>
    setChosenSkills(
      selectedSkills.includes(id)
        ? selectedSkills.filter((x) => x !== id)
        : [...selectedSkills, id].slice(0, 3),
    );
  const resetAndClose = () => {
    setObserverId(null);
    setChosenSkills(null);
    setTitle('');
    setNote('');
    setWhen('today');
    dialog.hide();
  };
  const submit = useApiMutation('observations', 'requestQuick', {
    onSuccess: (view) => {
      toast.success(
        `Feedback request sent to ${view.observer.displayName.split(' ')[0]}. They’ll see it in their requests.`,
      );
      resetAndClose();
    },
  });

  const occurredOn = { today: todayIso(), yesterday: daysAgoIso(1), pick: pickedDate }[when];
  const privacy = note.trim().length > 0 ? screenLocally(note) : { held: false, reasons: [] };
  const canSend =
    activeObserver !== null && selectedSkills.length > 0 && !privacy.held && !submit.isPending;

  return (
    <ResponsiveDialog
      open={dialog.open}
      onOpenChange={(o) => (o ? dialog.show({ skillId: dialog.skillId }) : resetAndClose())}
      title="Ask for feedback"
      description="Pick who saw your work and which skill to look at. Takes under 20 seconds."
    >
      {observersQuery.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-14" />
          <Skeleton className="h-24" />
        </div>
      ) : null}
      {!observersQuery.isPending && observers.length === 0 ? (
        <NoObserversBody onClose={resetAndClose} />
      ) : null}
      {!observersQuery.isPending && observers.length > 0 ? (
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSend || !activeObserver) return;
            submit.mutate({
              payload: {
                observerId: activeObserver,
                skillIds: [...selectedSkills],
                kind,
                title: title.trim() || null,
                occurredOn: occurredOn as never,
                mode,
                note: note.trim() || null,
              },
            });
          }}
        >
          <ObserverCards observers={observers} activeId={activeObserver} onSelect={setObserverId} />
          <SkillSelector
            focusSkills={focusSkills}
            allSkills={allSkills}
            selected={selectedSkills}
            onToggle={toggleSkill}
          />
          <WorkContextFields
            kind={kind}
            onKind={setKind}
            title={title}
            onTitle={setTitle}
            when={when}
            onWhen={setWhen}
            pickedDate={pickedDate}
            onPickedDate={setPickedDate}
          />
          <ModeAndNoteFields
            mode={mode}
            onMode={setMode}
            note={note}
            onNote={setNote}
            privacy={privacy}
          />
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSend}>
              {submit.isPending ? 'Sending…' : 'Send feedback request'}
            </Button>
          </div>
        </form>
      ) : null}
    </ResponsiveDialog>
  );
};
