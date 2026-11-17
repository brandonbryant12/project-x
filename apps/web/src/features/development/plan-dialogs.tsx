import type { PersonSummary, PlanView } from '@repo/api';
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
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  Textarea,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';
import { daysAgoIso, levelName, todayIso } from '@/lib/format.ts';

const plusMonths = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
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

/** Start a plan: one to three focus skills, each with a target level. */
export const CreatePlanDialog = ({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const skills = useQuery({ ...queryOptions('catalog', 'skills', { query: {} }), enabled: open });
  const [title, setTitle] = useState('');
  const [intent, setIntent] = useState('');
  const [periodEnd, setPeriodEnd] = useState(plusMonths(6));
  const [focus, setFocus] = useState<ReadonlyArray<{ skillId: SkillId; targetLevel: Level }>>([]);
  const create = useApiMutation('development', 'createPlan', {
    onSuccess: () => {
      toast.success('Plan started. Add the work that will develop it.');
      onClose();
    },
  });
  const toggle = (skillId: SkillId) =>
    setFocus((f) =>
      f.some((x) => x.skillId === skillId)
        ? f.filter((x) => x.skillId !== skillId)
        : [...f, { skillId, targetLevel: 3 as Level }].slice(0, 3),
    );
  const valid = title.trim().length >= 3 && focus.length > 0;
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Start a plan"
      description="Choose up to three skills and the level you are aiming for. Your coach agrees it with you."
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          create.mutate({
            payload: {
              title: title.trim(),
              intent: intent.trim(),
              periodStart: todayIso() as never,
              periodEnd: periodEnd as never,
              focusSkills: [...focus],
            },
          });
        }}
      >
        <Field>
          <Label htmlFor="plan-title">Name it</Label>
          <Input
            id="plan-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Lead with discovery"
          />
        </Field>
        <Field>
          <Label htmlFor="plan-intent">Why this matters to your practice</Label>
          <Textarea
            id="plan-intent"
            rows={2}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
          />
          <FieldHint>In your own words. Never production numbers.</FieldHint>
        </Field>
        <Field>
          <Label>Focus skills</Label>
          <div className="flex flex-wrap gap-1.5">
            {(skills.data ?? []).map((s) => (
              <SkillToggle
                key={s.id}
                name={s.name}
                on={focus.some((f) => f.skillId === s.id)}
                onClick={() => toggle(s.id)}
              />
            ))}
          </div>
          {focus.length > 0 ? (
            <div className="mt-2 grid gap-2">
              {focus.map((f) => (
                <div key={f.skillId} className="flex items-center justify-between gap-3 text-ui">
                  <span className="text-ink">
                    {skills.data?.find((s) => s.id === f.skillId)?.name}
                  </span>
                  <NativeSelect
                    aria-label="Target level"
                    className="w-56"
                    value={f.targetLevel}
                    onChange={(e) =>
                      setFocus((all) =>
                        all.map((x) =>
                          x.skillId === f.skillId
                            ? { ...x, targetLevel: Number(e.target.value) as Level }
                            : x,
                        ),
                      )
                    }
                  >
                    {[2, 3, 4].map((l) => (
                      <option key={l} value={l}>
                        Aim for {levelName(l)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
          ) : null}
          <FieldHint>Up to three. Fewer is usually better.</FieldHint>
        </Field>
        <Field>
          <Label htmlFor="plan-end">Runs until</Label>
          <Input
            id="plan-end"
            type="date"
            min={daysAgoIso(-14)}
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || create.isPending}>
            {create.isPending ? 'Starting…' : 'Start plan'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

const SkillsField = ({
  plan,
  skillIds,
  onChange,
}: {
  readonly plan: PlanView;
  readonly skillIds: ReadonlyArray<SkillId>;
  readonly onChange: (ids: ReadonlyArray<SkillId>) => void;
}) => (
  <Field>
    <Label>Skills it builds</Label>
    <div className="flex flex-wrap gap-1.5">
      {plan.focusSkills.map((f) => (
        <SkillToggle
          key={f.skill.id}
          name={f.skill.name}
          on={skillIds.includes(f.skill.id)}
          onClick={() =>
            onChange(
              skillIds.includes(f.skill.id)
                ? skillIds.filter((x) => x !== f.skill.id)
                : [...skillIds, f.skill.id].slice(0, 3),
            )
          }
        />
      ))}
    </div>
  </Field>
);

/** The observation commitment: who will see the work, and how. */
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
      <Label htmlFor="activity-observer">Who will see it</Label>
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

/** Add work to a plan, with the observation commitment: who will see it, and how. */
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
      toast.success('Work added.');
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
      title="Add work"
      description="Work you will do anyway: a meeting, a review, a conversation."
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
          <Label htmlFor="activity-template">Start from</Label>
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
            <option value="">Something of my own</option>
            {(templates.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
          {template?.observationTip ? (
            <FieldHint>For your observer: {template.observationTip}</FieldHint>
          ) : null}
        </Field>
        <Field>
          <Label htmlFor="activity-title">
            {template ? 'Your name for it · optional' : 'What is the work?'}
          </Label>
          <Input
            id="activity-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={template?.name ?? 'e.g. Discovery meetings with new households'}
          />
        </Field>
        <SkillsField plan={plan} skillIds={skillIds} onChange={setSkillIds} />
        <CommitmentFields
          observers={observers}
          observerId={observerId}
          onObserver={setObserverId}
          mode={mode}
          onMode={setMode}
        />
        <Field>
          <Label htmlFor="activity-due">Aim to do it by</Label>
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
            {add.isPending ? 'Adding…' : 'Add work'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};
