import type { ActivityView, PersonSummary, PlanView, WorkTemplate } from '@repo/api';
import {
  MAX_SKILLS_CEILING,
  OBSERVATION_MODE_LABELS,
  OBSERVATION_MODES,
  type ActivityTemplateId,
  type ObservationMode,
  type PersonId,
  type SkillId,
  type SkillRole,
} from '@repo/domain';
import {
  Button,
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  SegmentedControl,
  SegmentedItem,
  Textarea,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';
import { SkillToggle } from './plan-dialogs.tsx';

const plusMonths = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

interface ChosenSkill {
  readonly skillId: SkillId;
  readonly name: string;
  readonly role: SkillRole;
}

/** Making one skill primary makes every other one secondary: at most one primary. */
const withRole = (
  skills: ReadonlyArray<ChosenSkill>,
  skillId: SkillId,
  role: SkillRole,
): ReadonlyArray<ChosenSkill> =>
  skills.map((s) => {
    if (s.skillId === skillId) return { ...s, role };
    return role === 'primary' ? { ...s, role: 'secondary' } : s;
  });

/**
 * Every skill the work builds, each with its role. Focus skills are one tap
 * away; any other published skill can be added. Up to the hard ceiling.
 */
const SkillsEditor = ({
  plan,
  skills,
  onChange,
  template,
}: {
  readonly plan: PlanView;
  readonly skills: ReadonlyArray<ChosenSkill>;
  readonly onChange: (skills: ReadonlyArray<ChosenSkill>) => void;
  readonly template: WorkTemplate | undefined;
}) => {
  const catalog = useQuery(queryOptions('catalog', 'skills', { query: {} }));
  const full = skills.length >= MAX_SKILLS_CEILING;
  const chosen = new Set(skills.map((s) => s.skillId));
  const add = (skillId: SkillId, name: string) =>
    onChange([
      ...skills,
      { skillId, name, role: skills.some((s) => s.role === 'primary') ? 'secondary' : 'primary' },
    ]);
  const others = (catalog.data ?? []).filter(
    (s) => !chosen.has(s.id) && !plan.focusSkills.some((f) => f.skill.id === s.id),
  );
  const fromTemplate = (skillId: SkillId) => template?.skills.find((k) => k.skill.id === skillId);
  return (
    <Field>
      <Label>Skills it builds</Label>
      {skills.length > 0 ? (
        <ul className="grid divide-y divide-line rounded-control border border-line">
          {skills.map((s) => {
            const suggested = fromTemplate(s.skillId);
            return (
              <li
                key={s.skillId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2"
              >
                <span className="min-w-0 flex-1 text-ui text-ink">
                  {s.name}
                  {suggested?.points != null && suggested.role === s.role ? (
                    <span className="block text-meta text-ink-3">
                      {suggested.points} points from the template
                    </span>
                  ) : null}
                </span>
                <SegmentedControl
                  type="single"
                  aria-label={`Role of ${s.name}`}
                  value={s.role}
                  onValueChange={(v) => v && onChange(withRole(skills, s.skillId, v as SkillRole))}
                >
                  <SegmentedItem value="primary">Primary</SegmentedItem>
                  <SegmentedItem value="secondary">Secondary</SegmentedItem>
                </SegmentedControl>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${s.name}`}
                  onClick={() => onChange(skills.filter((x) => x.skillId !== s.skillId))}
                >
                  <XIcon />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {plan.focusSkills
          .filter((f) => !chosen.has(f.skill.id))
          .map((f) => (
            <SkillToggle
              key={f.skill.id}
              name={`+ ${f.skill.name}`}
              on={false}
              disabled={full}
              onClick={() => add(f.skill.id, f.skill.name)}
            />
          ))}
        {others.length > 0 ? (
          <NativeSelect
            aria-label="Add another skill"
            className="w-56"
            value=""
            disabled={full}
            onChange={(e) => {
              const picked = others.find((s) => s.id === e.target.value);
              if (picked) add(picked.id, picked.name);
            }}
          >
            <option value="">Add another skill…</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </div>
      <FieldHint>
        At most one primary skill: the main thing this work develops. The observer confirms the
        roles when they sign. Up to {MAX_SKILLS_CEILING} skills.
      </FieldHint>
    </Field>
  );
};

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

/**
 * Add work to a plan, or change planned work: what it is, the skills it builds
 * with their roles, the observation commitment and when. Opened only when the
 * view says the viewer may (`canAddWork`, `activity.canEdit`).
 */
export const WorkDialog = ({
  plan,
  activity,
  open,
  onClose,
}: {
  readonly plan: PlanView;
  /** The work to change; absent to add new work. */
  readonly activity?: ActivityView | null;
  readonly open: boolean;
  readonly onClose: () => void;
}) => (
  <ResponsiveDialog
    open={open}
    onOpenChange={(o) => !o && onClose()}
    title={activity ? 'Edit work' : 'Add work'}
    description={
      activity
        ? 'Changes apply to observations asked for from now on.'
        : 'Work you will do anyway: a meeting, a review, a conversation.'
    }
  >
    <WorkForm plan={plan} activity={activity ?? null} onClose={onClose} />
  </ResponsiveDialog>
);

/** Who the work may name as its observer: the coach, the leader, or the one already named. */
const observerChoices = (plan: PlanView, activity: ActivityView | null) =>
  [plan.coach, plan.leader, activity?.intendedObserver ?? null].filter(
    (p, i, all): p is PersonSummary => p !== null && all.findIndex((x) => x?.id === p.id) === i,
  );

const WorkForm = ({
  plan,
  activity,
  onClose,
}: {
  readonly plan: PlanView;
  readonly activity: ActivityView | null;
  readonly onClose: () => void;
}) => {
  const templates = useQuery({
    ...queryOptions('development', 'workTemplates', undefined),
    enabled: !activity,
  });
  const [templateId, setTemplateId] = useState<ActivityTemplateId | ''>('');
  const [title, setTitle] = useState(activity?.title ?? '');
  const [description, setDescription] = useState(activity?.description ?? '');
  const [skills, setSkills] = useState<ReadonlyArray<ChosenSkill>>(
    activity
      ? activity.skills.map((k) => ({ skillId: k.skill.id, name: k.skill.name, role: k.role }))
      : plan.focusSkills
          .slice(0, 1)
          .map((f) => ({ skillId: f.skill.id, name: f.skill.name, role: 'primary' as const })),
  );
  const [observerId, setObserverId] = useState<PersonId | ''>(
    activity ? (activity.intendedObserver?.id ?? '') : (plan.coach?.id ?? plan.leader?.id ?? ''),
  );
  const [mode, setMode] = useState<ObservationMode>(activity?.intendedMode ?? 'saw_it');
  const [dueOn, setDueOn] = useState<string>(activity ? (activity.dueOn ?? '') : plusMonths(1));
  const onSuccess = () => {
    toast.success(activity ? 'Work updated.' : 'Work added.');
    onClose();
  };
  const add = useApiMutation('development', 'addActivity', { onSuccess });
  const update = useApiMutation('development', 'updateActivity', { onSuccess });
  const template = templates.data?.find((t) => t.id === templateId);
  const observers = observerChoices(plan, activity);
  const name = title.trim() || template?.name || '';
  const valid = name.length >= 3 && skills.length > 0;
  const pending = add.isPending || update.isPending;
  const chooseTemplate = (id: ActivityTemplateId | '') => {
    setTemplateId(id);
    const t = templates.data?.find((x) => x.id === id);
    setDescription(t?.description ?? '');
    if (t && t.skills.length > 0) {
      setSkills(
        t.skills
          .slice(0, MAX_SKILLS_CEILING)
          .map((k) => ({ skillId: k.skill.id, name: k.skill.name, role: k.role })),
      );
    }
  };
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const fields = {
          title: name,
          description: description.trim(),
          skills: skills.map((s) => ({ skillId: s.skillId, role: s.role })),
          dueOn: (dueOn || null) as never,
          intendedObserverId: observerId || null,
          intendedMode: observerId ? mode : null,
        };
        if (activity)
          update.mutate({
            params: { id: activity.id },
            payload: { ...fields, version: activity.version },
          });
        else
          add.mutate({
            params: { id: plan.id },
            payload: { ...fields, templateId: templateId || null },
          });
      }}
    >
      {activity ? null : (
        <Field>
          <Label htmlFor="activity-template">Start from</Label>
          <NativeSelect
            id="activity-template"
            value={templateId}
            onChange={(e) => chooseTemplate(e.target.value as ActivityTemplateId | '')}
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
      )}
      <Field>
        <Label htmlFor="activity-title">
          {template ? 'Your name for it · optional' : 'What is the work?'}
        </Label>
        <Input
          id="activity-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={template?.name ?? 'e.g. Discovery meetings with new households'}
        />
      </Field>
      <Field>
        <Label htmlFor="activity-description">What it involves · optional</Label>
        <Textarea
          id="activity-description"
          rows={3}
          maxLength={600}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <FieldHint>
          Describe the work, not the client. No client names or account details.
        </FieldHint>
      </Field>
      <SkillsEditor plan={plan} skills={skills} onChange={setSkills} template={template} />
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
        <Button type="submit" variant="primary" disabled={!valid || pending}>
          {activity ? 'Save work' : 'Add work'}
        </Button>
      </div>
    </form>
  );
};
