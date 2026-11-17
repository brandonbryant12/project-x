import type { PlanView } from '@repo/api';
import { MAX_FOCUS_SKILLS, type Level, type SkillId } from '@repo/domain';
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

/** Said wherever a target is chosen or shown. */
export const TARGET_NOTE =
  'A plan target is reviewed with you by a person when the plan closes. Badges exist for levels 2 and 3.';

export const SkillToggle = ({
  name,
  on,
  onClick,
  disabled = false,
}: {
  readonly name: string;
  readonly on: boolean;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) => (
  <button
    type="button"
    aria-pressed={on}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-ui transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      on
        ? 'border-primary bg-primary-soft text-primary-ink'
        : 'border-line text-ink-2 hover:bg-sunken',
    )}
  >
    {name}
  </button>
);

type Focus = ReadonlyArray<{ readonly skillId: SkillId; readonly targetLevel: Level }>;

/** One to three focus skills, each with a target level (2 to 4). */
const FocusSkillsField = ({
  focus,
  onChange,
  enabled,
}: {
  readonly focus: Focus;
  readonly onChange: (focus: Focus) => void;
  readonly enabled: boolean;
}) => {
  const skills = useQuery({ ...queryOptions('catalog', 'skills', { query: {} }), enabled });
  const toggle = (skillId: SkillId) =>
    onChange(
      focus.some((x) => x.skillId === skillId)
        ? focus.filter((x) => x.skillId !== skillId)
        : [...focus, { skillId, targetLevel: 3 as Level }].slice(0, MAX_FOCUS_SKILLS),
    );
  return (
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
              <span className="text-ink">{skills.data?.find((s) => s.id === f.skillId)?.name}</span>
              <NativeSelect
                aria-label="Target level"
                className="w-56"
                value={f.targetLevel}
                onChange={(e) =>
                  onChange(
                    focus.map((x) =>
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
      <FieldHint>Up to three. Fewer is usually better. {TARGET_NOTE}</FieldHint>
    </Field>
  );
};

/** Start a plan: one to three focus skills, each with a target level. */
export const CreatePlanDialog = ({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) => (
  <ResponsiveDialog
    open={open}
    onOpenChange={(o) => !o && onClose()}
    title="Start a plan"
    description="Choose up to three skills and the level you are aiming for. Your coach agrees it with you."
  >
    <CreatePlanForm onClose={onClose} />
  </ResponsiveDialog>
);

const CreatePlanForm = ({ onClose }: { readonly onClose: () => void }) => {
  const [title, setTitle] = useState('');
  const [intent, setIntent] = useState('');
  const [periodEnd, setPeriodEnd] = useState(plusMonths(6));
  const [focus, setFocus] = useState<Focus>([]);
  const create = useApiMutation('development', 'createPlan', {
    onSuccess: () => {
      toast.success('Plan started. Add the work that will develop it.');
      onClose();
    },
  });
  const valid = title.trim().length >= 3 && focus.length > 0;
  return (
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
      <TitleField value={title} onChange={setTitle} />
      <IntentField value={intent} onChange={setIntent} />
      <FocusSkillsField focus={focus} onChange={setFocus} enabled />
      <EndField value={periodEnd} onChange={setPeriodEnd} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!valid || create.isPending}>
          {create.isPending ? 'Starting…' : 'Start plan'}
        </Button>
      </div>
    </form>
  );
};

const TitleField = ({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) => (
  <Field>
    <Label htmlFor="plan-title">Name it</Label>
    <Input
      id="plan-title"
      value={value}
      maxLength={120}
      onChange={(e) => onChange(e.target.value)}
      placeholder="e.g. Lead with discovery"
    />
  </Field>
);

const IntentField = ({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) => (
  <Field>
    <Label htmlFor="plan-intent">Why this matters to your practice</Label>
    <Textarea
      id="plan-intent"
      rows={2}
      maxLength={600}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
    <FieldHint>In your own words. Never production numbers.</FieldHint>
  </Field>
);

const EndField = ({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) => (
  <Field>
    <Label htmlFor="plan-end">Runs until</Label>
    <Input
      id="plan-end"
      type="date"
      min={daysAgoIso(-14)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </Field>
);

/**
 * Edit a plan: its name, intent and end date while it is open; its focus
 * skills and targets only while it is a draft (the view says which).
 */
export const EditPlanDialog = ({
  plan,
  open,
  onClose,
}: {
  readonly plan: PlanView;
  readonly open: boolean;
  readonly onClose: () => void;
}) => (
  <ResponsiveDialog
    open={open}
    onOpenChange={(o) => !o && onClose()}
    title="Edit plan"
    description={
      plan.canEditFocusSkills
        ? 'Your coach agrees the plan once you propose it.'
        : 'To change the focus skills of an agreed plan, take it back to a draft first.'
    }
  >
    <EditPlanForm plan={plan} onClose={onClose} />
  </ResponsiveDialog>
);

const EditPlanForm = ({
  plan,
  onClose,
}: {
  readonly plan: PlanView;
  readonly onClose: () => void;
}) => {
  const [title, setTitle] = useState(plan.title);
  const [intent, setIntent] = useState(plan.intent);
  const [periodEnd, setPeriodEnd] = useState<string>(plan.periodEnd);
  const [focus, setFocus] = useState<Focus>(
    plan.focusSkills.map((f) => ({ skillId: f.skill.id, targetLevel: f.targetLevel as Level })),
  );
  const update = useApiMutation('development', 'updatePlan', {
    onSuccess: () => {
      toast.success('Plan updated.');
      onClose();
    },
  });
  const focusChanged =
    plan.canEditFocusSkills &&
    JSON.stringify(focus) !==
      JSON.stringify(
        plan.focusSkills.map((f) => ({ skillId: f.skill.id, targetLevel: f.targetLevel })),
      );
  const valid = title.trim().length >= 3 && periodEnd > plan.periodStart && focus.length > 0;
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        update.mutate({
          params: { id: plan.id },
          payload: {
            version: plan.version,
            title: title.trim(),
            intent: intent.trim(),
            periodEnd: periodEnd as never,
            ...(focusChanged && { focusSkills: [...focus] }),
          },
        });
      }}
    >
      <TitleField value={title} onChange={setTitle} />
      <IntentField value={intent} onChange={setIntent} />
      {plan.canEditFocusSkills ? (
        <FocusSkillsField focus={focus} onChange={setFocus} enabled />
      ) : null}
      <EndField value={periodEnd} onChange={setPeriodEnd} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!valid || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save plan'}
        </Button>
      </div>
    </form>
  );
};
