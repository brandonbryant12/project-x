import type { InteractionView, SkillRef } from '@repo/api';
import {
  OBSERVATION_MODE_LABELS,
  OBSERVATION_MODES,
  type ObservationMode,
  type PersonId,
  type SkillId,
} from '@repo/domain';
import {
  Button,
  cn,
  Field,
  FieldHint,
  Label,
  PersonAvatar,
  SegmentedControl,
  SegmentedItem,
  Skeleton,
  Textarea,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CheckIcon } from 'lucide-react';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';
import { formatDate } from '@/lib/format.ts';

const MODE_HINT: Record<ObservationMode, string> = {
  saw_it: 'They were there',
  reviewed_work: 'They’ll review what I share',
  discussed: 'We’ll debrief',
};

type Eligible = InteractionView['eligibleObservers'][number];

const ObserverPicker = ({
  observers,
  value,
  onChange,
}: {
  readonly observers: ReadonlyArray<Eligible>;
  readonly value: PersonId | null;
  readonly onChange: (id: PersonId) => void;
}) => (
  <fieldset className="grid gap-3">
    <legend className="mb-1 text-ui font-medium text-ink">Who</legend>
    {(
      [
        ['leader', 'Your leader'],
        ['coach', 'Your coaches'],
        ['designated', 'Asked to observe you'],
      ] as const
    ).map(([basis, label]) => {
      const people = observers.filter((o) => o.basis === basis);
      if (people.length === 0) return null;
      return (
        <div key={basis} className="grid gap-1.5">
          <p className="text-meta text-ink-3">{label}</p>
          {people.map((o) => (
            <label
              key={o.person.id}
              className={cn(
                'flex min-h-14 cursor-pointer items-center gap-3 rounded-control border px-3 py-2 transition-colors',
                value === o.person.id
                  ? 'border-primary bg-primary-soft/40'
                  : 'border-line hover:bg-sunken',
              )}
            >
              <input
                type="radio"
                name="observer"
                className="sr-only"
                checked={value === o.person.id}
                onChange={() => onChange(o.person.id)}
              />
              <PersonAvatar person={o.person} size="md" />
              <span className="grid flex-1">
                <span className="text-ui font-medium text-ink">{o.person.displayName}</span>
                <span className="text-meta text-ink-3">{o.hint ?? o.person.title}</span>
              </span>
              {value === o.person.id ? <CheckIcon className="size-4 text-primary" /> : null}
            </label>
          ))}
        </div>
      );
    })}
  </fieldset>
);

const SkillPicker = ({
  skills,
  chosen,
  onToggle,
  max,
}: {
  readonly skills: ReadonlyArray<SkillRef>;
  readonly chosen: ReadonlyArray<SkillId>;
  readonly onToggle: (id: SkillId) => void;
  readonly max: number;
}) => (
  <Field>
    <Label>Skills to look at</Label>
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s) => {
        const on = chosen.includes(s.id);
        return (
          <button
            type="button"
            key={s.id}
            aria-pressed={on}
            onClick={() => onToggle(s.id)}
            className={cn(
              'inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-ui transition-colors',
              on
                ? 'border-primary bg-primary-soft text-primary-ink'
                : 'border-line text-ink-2 hover:bg-sunken',
            )}
          >
            {s.name}
          </button>
        );
      })}
    </div>
    <FieldHint>
      Up to {max}. The work’s own skills come first; your observer confirms which was primary.
    </FieldHint>
  </Field>
);

/**
 * Request observation (ux-brief §2.4). Only eligible observers are offered;
 * credit still needs their signature. Not optimistic about credit — it only
 * creates a request.
 */
export const RequestObservationDialog = ({
  interactionId,
  onClose,
}: {
  readonly interactionId: string | null;
  readonly onClose: () => void;
}) => (
  <ResponsiveDialog
    open={interactionId !== null}
    onOpenChange={(o) => !o && onClose()}
    title="Ask someone to observe"
    description="Only someone who saw it, or reviews it with you, can sign. Credit comes when they do."
  >
    {/* Keyed by the work: choices never carry over from another piece of work. */}
    {interactionId ? (
      <RequestForm key={interactionId} interactionId={interactionId} onClose={onClose} />
    ) : null}
  </ResponsiveDialog>
);

const RequestForm = ({
  interactionId,
  onClose,
}: {
  readonly interactionId: string;
  readonly onClose: () => void;
}) => {
  const navigate = useNavigate();
  const interaction = useQuery({
    ...queryOptions('development', 'interaction', {
      params: { id: interactionId as never },
    }),
  });
  const catalog = useQuery(queryOptions('catalog', 'skills', { query: {} }));
  const [observerId, setObserverId] = useState<PersonId | null>(null);
  const [mode, setMode] = useState<ObservationMode>('saw_it');
  const [skillIds, setSkillIds] = useState<ReadonlyArray<SkillId> | null>(null);
  const [note, setNote] = useState('');
  const request = useApiMutation('observations', 'request', {
    onSuccess: (view) => {
      toast.success(
        `Request sent to ${view.observer.displayName.split(' ')[0]}. Open until ${formatDate(view.dueAt, { weekday: 'short' })}.`,
      );
      onClose();
      void navigate({ to: '/observations/$id', params: { id: view.id } });
    },
  });
  const data = interaction.data;
  const max = data?.maxSkills ?? 0;
  // Until the coachee changes them: the work's own skills, primary first.
  const chosenSkills = skillIds ?? (data?.skills ?? []).map((s) => s.skill.id).slice(0, max);
  const toggleSkill = (id: SkillId) =>
    setSkillIds(
      chosenSkills.includes(id)
        ? chosenSkills.filter((x) => x !== id)
        : [...chosenSkills, id].slice(0, max),
    );
  const workSkills = (data?.skills ?? []).map((s) => s.skill);
  const offered = [
    ...workSkills,
    ...(catalog.data ?? [])
      .filter((s) => !workSkills.some((w) => w.id === s.id))
      .map((s) => ({ id: s.id, slug: s.slug, name: s.name, domain: s.domain })),
  ];
  const available = (data?.eligibleObservers ?? []).filter((o) => !o.alreadyAsked);
  const observer = observerId ?? available[0]?.person.id ?? null;

  return (
    <>
      {!data ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : null}
      {data && available.length === 0 ? (
        <p className="text-body text-ink-2">
          Everyone who can observe this has already been asked. You can follow up from your plan.
        </p>
      ) : null}
      {data && available.length > 0 ? (
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!observer || chosenSkills.length === 0) return;
            request.mutate({
              payload: {
                interactionId: data.id,
                observerId: observer,
                mode,
                skillIds: [...chosenSkills],
                note: note.trim() || null,
              },
            });
          }}
        >
          <ObserverPicker observers={available} value={observer} onChange={setObserverId} />
          <Field>
            <Label>How they’ll see it</Label>
            <SegmentedControl
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as ObservationMode)}
            >
              {OBSERVATION_MODES.map((m) => (
                <SegmentedItem key={m} value={m} title={OBSERVATION_MODE_LABELS[m]}>
                  {MODE_HINT[m]}
                </SegmentedItem>
              ))}
            </SegmentedControl>
          </Field>
          <SkillPicker skills={offered} chosen={chosenSkills} onToggle={toggleSkill} max={max} />
          <Field>
            <Label htmlFor="request-note">Note to them · optional</Label>
            <Textarea
              id="request-note"
              rows={2}
              maxLength={280}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-meta text-ink-3">Open for 14 days. You can withdraw any time.</p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!observer || chosenSkills.length === 0 || request.isPending}
              >
                {request.isPending ? 'Sending…' : 'Send request'}
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </>
  );
};
