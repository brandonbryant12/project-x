import type { PersonSummary, PlanView, SkillCard } from '@repo/api';
import {
  OBSERVATION_MODE_LABELS,
  OBSERVATION_MODES,
  type ActivityTemplateId,
  type Level,
  type ObservationMode,
  type PersonId,
  type SkillId,
} from '@repo/domain';
import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  Pill,
  Skeleton,
  Textarea,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';
import { domainLabel, levelName, todayIso } from '@/lib/format.ts';

const plusMonths = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

const LEVEL_HINTS: Record<number, string> = {
  2: 'Guided practice with your coach or leader',
  3: 'Consistent execution on your own',
  4: 'Modeling and coaching peers on this skill',
};

const autoTitle = (
  selected: ReadonlyArray<{ skillId: SkillId }>,
  skills: ReadonlyArray<SkillCard>,
) => {
  const names = selected
    .map((f) => skills.find((s) => s.id === f.skillId)?.name)
    .filter((n): n is string => Boolean(n));
  if (names.length === 0) return 'My coaching focus';
  if (names.length === 1) return `Build ${names[0]}`;
  return `Focus on ${names.slice(0, 2).join(' & ')}`;
};

const skillCardTone = (selected: boolean, maxed: boolean) => {
  if (selected) return 'border-primary bg-primary-soft/40 ring-1 ring-primary/25';
  if (maxed) return 'border-line bg-sunken/50 opacity-60';
  return 'border-line bg-surface hover:border-line-strong';
};

const SkillPickerCard = ({
  skill,
  targetLevel,
  maxed,
  onToggle,
  onLevel,
}: {
  readonly skill: SkillCard;
  readonly targetLevel: Level | null;
  readonly maxed: boolean;
  readonly onToggle: () => void;
  readonly onLevel: (level: Level) => void;
}) => {
  const selected = targetLevel !== null;
  return (
    <div className={cn('rounded-card border transition-colors', skillCardTone(selected, maxed))}>
      <button
        type="button"
        aria-pressed={selected}
        disabled={maxed}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-start gap-3 p-3 text-left disabled:cursor-not-allowed"
      >
        <span
          className={cn(
            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-fg'
              : 'border-line-strong bg-surface',
          )}
        >
          {selected ? <CheckIcon className="size-3" /> : null}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-ui font-semibold text-ink">{skill.name}</span>
            <Pill tone="outline">{domainLabel(skill.domain)}</Pill>
          </span>
          <span className="text-meta text-ink-2">{skill.summary}</span>
        </span>
      </button>
      {selected ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-primary/15 px-3 py-2.5 pl-11">
          <span className="text-meta text-ink-2">{LEVEL_HINTS[targetLevel]}</span>
          <NativeSelect
            aria-label={`Target level for ${skill.name}`}
            className="h-8 w-48 text-meta"
            value={targetLevel}
            onChange={(e) => onLevel(Number(e.target.value) as Level)}
          >
            {[2, 3, 4].map((l) => (
              <option key={l} value={l}>
                Goal: {levelName(l)}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </div>
  );
};

const submitLabel = (pending: boolean, editing: boolean) => {
  if (pending) return 'Saving…';
  return editing ? 'Save focus skills' : 'Start growing';
};

/**
 * Pick 1–3 focus skills with clear descriptions and level explanations.
 * Works for BOTH starting fresh (instant-active!) and updating an active plan.
 */
export const FocusSkillsDialog = ({
  open,
  onClose,
  existingPlan = null,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly existingPlan?: PlanView | null;
}) => {
  const skillsQuery = useQuery({
    ...queryOptions('catalog', 'skills', { query: {} }),
    enabled: open,
  });
  const skills = skillsQuery.data ?? [];

  const [focus, setFocus] = useState<ReadonlyArray<{ skillId: SkillId; targetLevel: Level }>>(() =>
    existingPlan
      ? existingPlan.focusSkills.map((f) => ({
          skillId: f.skill.id,
          targetLevel: f.targetLevel as Level,
        }))
      : [],
  );
  const [title, setTitle] = useState(existingPlan?.title ?? '');
  const [intent, setIntent] = useState(existingPlan?.intent ?? '');
  const [showCustom, setShowCustom] = useState(false);

  const create = useApiMutation('development', 'createPlan', {
    onSuccess: () => {
      toast.success('Focus skills saved — you’re ready to request feedback.');
      onClose();
    },
  });
  const update = useApiMutation('development', 'updatePlan', {
    onSuccess: () => {
      toast.success('Focus skills updated.');
      onClose();
    },
  });

  const toggle = (skillId: SkillId) =>
    setFocus((current) => {
      if (current.some((x) => x.skillId === skillId)) {
        return current.filter((x) => x.skillId !== skillId);
      }
      return current.length < 3 ? [...current, { skillId, targetLevel: 3 as Level }] : current;
    });

  const setLevel = (skillId: SkillId, targetLevel: Level) =>
    setFocus((all) => all.map((x) => (x.skillId === skillId ? { ...x, targetLevel } : x)));

  const pending = create.isPending || update.isPending;
  const valid = focus.length >= 1 && focus.length <= 3;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={existingPlan ? 'Edit focus skills' : 'Pick 1–3 focus skills'}
      description="Choose the skills you want feedback on right now. You can change these anytime."
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const finalTitle = title.trim() || autoTitle(focus, skills);
          if (existingPlan) {
            update.mutate({
              params: { id: existingPlan.id },
              payload: { title: finalTitle, intent: intent.trim(), focusSkills: [...focus] },
            });
          } else {
            create.mutate({
              payload: {
                title: finalTitle,
                intent: intent.trim(),
                periodStart: todayIso() as never,
                periodEnd: plusMonths(6) as never,
                focusSkills: [...focus],
                startActive: true,
              },
            });
          }
        }}
      >
        {skillsQuery.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <div className="grid max-h-[340px] gap-2 overflow-y-auto pr-1">
            {skills.map((s) => {
              const chosen = focus.find((f) => f.skillId === s.id);
              return (
                <SkillPickerCard
                  key={s.id}
                  skill={s}
                  targetLevel={chosen?.targetLevel ?? null}
                  maxed={!chosen && focus.length >= 3}
                  onToggle={() => toggle(s.id)}
                  onLevel={(l) => setLevel(s.id, l)}
                />
              );
            })}
          </div>
        )}

        <Collapsible open={showCustom} onOpenChange={setShowCustom}>
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-meta font-medium text-ink-2 hover:text-ink">
            <ChevronDownIcon
              className={cn('size-3.5 transition-transform', showCustom && 'rotate-180')}
            />
            Customize goal title & personal note (optional)
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-3 rounded-card bg-sunken/70 p-3.5">
            <Field>
              <Label htmlFor="plan-title">Goal title</Label>
              <Input
                id="plan-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={autoTitle(focus, skills)}
              />
            </Field>
            <Field>
              <Label htmlFor="plan-intent">Why this matters to your practice</Label>
              <Textarea
                id="plan-intent"
                rows={2}
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="e.g. I want my first client meetings to uncover real goals before talking products."
              />
            </Field>
          </CollapsibleContent>
        </Collapsible>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-meta text-ink-3 tabular">{focus.length} of 3 selected</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!valid || pending}>
              {submitLabel(pending, existingPlan !== null)}
            </Button>
          </div>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

const SkillToggle = ({
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
      'inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-ui transition-colors',
      on
        ? 'border-primary bg-primary-soft text-primary-ink'
        : 'border-line text-ink-2 hover:bg-sunken',
    )}
  >
    {name}
  </button>
);

const CommitmentFields = ({
  observers,
  observerId,
  onObserver,
  mode,
  onMode,
}: {
  readonly observers: ReadonlyArray<PersonSummary>;
  readonly observerId: PersonId | '';
  readonly onObserver: (id: PersonId | '') => void;
  readonly mode: ObservationMode;
  readonly onMode: (mode: ObservationMode) => void;
}) => (
  <div className="grid gap-5 sm:grid-cols-2">
    <Field>
      <Label htmlFor="activity-observer">Who will observe it</Label>
      <NativeSelect
        id="activity-observer"
        value={observerId}
        onChange={(e) => onObserver(e.target.value as PersonId | '')}
      >
        <option value="">Decide later</option>
        {observers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </NativeSelect>
    </Field>
    <Field>
      <Label htmlFor="activity-mode">How</Label>
      <NativeSelect
        id="activity-mode"
        disabled={!observerId}
        value={mode}
        onChange={(e) => onMode(e.target.value as ObservationMode)}
      >
        {OBSERVATION_MODES.map((m) => (
          <option key={m} value={m}>
            {OBSERVATION_MODE_LABELS[m]}
          </option>
        ))}
      </NativeSelect>
    </Field>
  </div>
);

/** Optional: add planned practice work to a plan (for structured coaching). */
export const AddActivityDialog = ({
  plan,
  open,
  onClose,
}: {
  readonly plan: PlanView;
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const templates = useQuery({
    ...queryOptions('catalog', 'templates', { query: {} }),
    enabled: open,
  });
  const [templateId, setTemplateId] = useState<ActivityTemplateId | ''>('');
  const [title, setTitle] = useState('');
  const [skillIds, setSkillIds] = useState<ReadonlyArray<SkillId>>(
    plan.focusSkills.map((f) => f.skill.id).slice(0, 1),
  );
  const [observerId, setObserverId] = useState<PersonId | ''>(
    plan.coach?.id ?? plan.leader?.id ?? '',
  );
  const [mode, setMode] = useState<ObservationMode>('saw_it');
  const [dueOn, setDueOn] = useState(plusMonths(1));
  const add = useApiMutation('development', 'addActivity', {
    onSuccess: () => {
      toast.success('Practice activity added.');
      onClose();
    },
  });
  const template = templates.data?.find((t) => t.id === templateId);
  const observers = [plan.coach, plan.leader].filter((p) => p !== null);
  const valid = (title.trim().length >= 3 || template) && skillIds.length > 0;
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Plan a practice activity"
      description="Optional: commit to a specific meeting or recurring client moment to practice."
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          add.mutate({
            params: { id: plan.id },
            payload: {
              templateId: templateId || null,
              title: title.trim() || template?.name || '',
              description: template?.description ?? '',
              targetSkillIds: [...skillIds],
              dueOn: dueOn as never,
              intendedObserverId: observerId || null,
              intendedMode: observerId ? mode : null,
            },
          });
        }}
      >
        <Field>
          <Label htmlFor="activity-template">Start from a template</Label>
          <NativeSelect
            id="activity-template"
            value={templateId}
            onChange={(e) => {
              const id = e.target.value as ActivityTemplateId | '';
              setTemplateId(id);
              const t = templates.data?.find((x) => x.id === id);
              if (t) setSkillIds(t.suggestedSkills.map((s) => s.id).slice(0, 3));
            }}
          >
            <option value="">Custom activity</option>
            {(templates.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
          {template?.observationTip ? (
            <FieldHint>Tip for your observer: {template.observationTip}</FieldHint>
          ) : null}
        </Field>
        <Field>
          <Label htmlFor="activity-title">
            {template ? 'Your label · optional' : 'What will you practice?'}
          </Label>
          <Input
            id="activity-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={template?.name ?? 'e.g. Discovery meetings with new households'}
          />
        </Field>
        <Field>
          <Label>Skills it builds</Label>
          <div className="flex flex-wrap gap-1.5">
            {plan.focusSkills.map((f) => (
              <SkillToggle
                key={f.skill.id}
                name={f.skill.name}
                on={skillIds.includes(f.skill.id)}
                onClick={() =>
                  setSkillIds(
                    skillIds.includes(f.skill.id)
                      ? skillIds.filter((x) => x !== f.skill.id)
                      : [...skillIds, f.skill.id].slice(0, 3),
                  )
                }
              />
            ))}
          </div>
        </Field>
        <CommitmentFields
          observers={observers}
          observerId={observerId}
          onObserver={setObserverId}
          mode={mode}
          onMode={setMode}
        />
        <Field>
          <Label htmlFor="activity-due">Target date</Label>
          <Input
            id="activity-due"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || add.isPending}>
            {add.isPending ? 'Adding…' : 'Add activity'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};
