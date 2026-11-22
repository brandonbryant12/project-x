import type { PersonSummary, PlanView, SkillCard } from '@repo/api';
import {
  OBSERVATION_MODE_LABELS,
  OBSERVATION_MODES,
  type ActivityTemplateId,
  type Level,
  type ObservationMode,
  type PersonId,
  type SkillId,
  type SkillTier,
} from '@repo/domain';
import {
  Button,
  CatalystArc,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  FieldHint,
  Input,
  Label,
  MasteryRing,
  NativeSelect,
  Pill,
  Skeleton,
  Textarea,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { findMatchingRareCombo, SIGNAL_META } from '@/features/catalog/catalog-visuals.tsx';
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

type PickerFilter = 'all' | SkillTier | 'lacking' | 'popular';

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
  const sig = SIGNAL_META[skill.signal];
  return (
    <div className={cn('rounded-card border transition-colors', skillCardTone(selected, maxed))}>
      <button
        type="button"
        aria-pressed={selected}
        disabled={maxed}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-start gap-3 p-3 text-left disabled:cursor-not-allowed"
      >
        <div className="relative mt-0.5 shrink-0">
          <MasteryRing
            level={skill.myHighestLevel ?? 0}
            current={skill.myCurrent}
            required={skill.myRequired}
            size="sm"
          />
          {selected ? (
            <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-primary text-primary-fg ring-2 ring-surface">
              <CheckIcon className="size-2.5" />
            </span>
          ) : null}
        </div>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-ui font-semibold text-ink">{skill.name}</span>
            <Pill tone={skill.tier === 'core' ? 'primary' : 'outline'}>
              {skill.tier === 'core' ? 'Core' : 'Common'}
            </Pill>
            {skill.signal !== 'balanced' ? <Pill tone={sig.tone}>{sig.label}</Pill> : null}
          </span>
          <span className="text-meta text-ink-2">{skill.summary}</span>
          <span className="text-meta text-ink-3">
            {domainLabel(skill.domain)} · {skill.holderCount} held · {skill.activeFocusCount} active
          </span>
        </span>
      </button>
      {selected ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-primary/15 px-3 py-2.5 pl-12">
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

const buildInitialFocus = (
  existingPlan: PlanView | null,
  initialSkillIds?: ReadonlyArray<SkillId>,
): ReadonlyArray<{ skillId: SkillId; targetLevel: Level }> => {
  if (initialSkillIds && initialSkillIds.length > 0) {
    const base = existingPlan
      ? existingPlan.focusSkills.map((f) => ({
          skillId: f.skill.id,
          targetLevel: f.targetLevel as Level,
        }))
      : [];
    const seen = new Set(initialSkillIds);
    const merged: Array<{ skillId: SkillId; targetLevel: Level }> = initialSkillIds.map((id) => ({
      skillId: id,
      targetLevel: (base.find((b) => b.skillId === id)?.targetLevel ?? 3) as Level,
    }));
    for (const item of base) {
      if (!seen.has(item.skillId) && merged.length < 3) {
        merged.push(item);
      }
    }
    return merged.slice(0, 3);
  }
  return existingPlan
    ? existingPlan.focusSkills.map((f) => ({
        skillId: f.skill.id,
        targetLevel: f.targetLevel as Level,
      }))
    : [];
};

const matchesFilter = (s: SkillCard, filter: PickerFilter, tag: string | null, q: string) => {
  if (filter === 'core' && s.tier !== 'core') return false;
  if (filter === 'common' && s.tier !== 'common') return false;
  if (filter === 'lacking' && s.signal !== 'scarce') return false;
  if (filter === 'popular' && s.signal !== 'popular') return false;
  if (tag && !s.tags.includes(tag)) return false;
  if (q.trim().length > 0) {
    const hay = `${s.name} ${s.summary} ${s.tags.join(' ')}`.toLowerCase();
    if (!hay.includes(q.trim().toLowerCase())) return false;
  }
  return true;
};

const PickerControls = ({
  q,
  onQ,
  filter,
  onFilter,
  selectedTag,
  onTag,
  tags,
  corePresetIds,
  topComboIds,
  gapPresetIds,
  onPreset,
}: {
  readonly q: string;
  readonly onQ: (v: string) => void;
  readonly filter: PickerFilter;
  readonly onFilter: (f: PickerFilter) => void;
  readonly selectedTag: string | null;
  readonly onTag: (tag: string | null) => void;
  readonly tags: ReadonlyArray<{ readonly tag: string }>;
  readonly corePresetIds: ReadonlyArray<SkillId>;
  readonly topComboIds: ReadonlyArray<SkillId>;
  readonly gapPresetIds: ReadonlyArray<SkillId>;
  readonly onPreset: (ids: ReadonlyArray<SkillId>) => void;
}) => (
  <div className="grid gap-3">
    {corePresetIds.length > 0 || topComboIds.length > 0 || gapPresetIds.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10.5px] tracking-wider text-ink-3 uppercase">
          Quick build:
        </span>
        {corePresetIds.length > 0 ? (
          <Button type="button" size="sm" variant="soft" onClick={() => onPreset(corePresetIds)}>
            Core essentials
          </Button>
        ) : null}
        {topComboIds.length > 0 ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onPreset(topComboIds)}>
            Rare combo
          </Button>
        ) : null}
        {gapPresetIds.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onPreset(gapPresetIds)}
          >
            Fill firm gaps
          </Button>
        ) : null}
      </div>
    ) : null}

    <div className="grid gap-2">
      <label className="relative block">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3"
        />
        <Input
          aria-label="Filter catalog skills"
          placeholder="Search skills or tags…"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          className="h-9 pl-8 text-ui"
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['all', 'All'],
            ['core', 'Core'],
            ['common', 'Common'],
            ['lacking', 'Lacking'],
            ['popular', 'Popular'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => onFilter(key)}
            className={cn(
              'h-7 cursor-pointer rounded-full border px-2.5 text-meta font-medium transition-colors',
              filter === key
                ? 'border-primary bg-primary-soft text-primary-ink'
                : 'border-line text-ink-2 hover:bg-sunken',
            )}
          >
            {label}
          </button>
        ))}
        {tags.slice(0, 5).map((t) => (
          <button
            key={t.tag}
            type="button"
            aria-pressed={selectedTag === t.tag}
            onClick={() => onTag(selectedTag === t.tag ? null : t.tag)}
            className={cn(
              'h-7 cursor-pointer rounded-full border px-2.5 text-meta transition-colors',
              selectedTag === t.tag
                ? 'border-brass bg-brass-soft text-brass-ink'
                : 'border-line text-ink-3 hover:bg-sunken hover:text-ink',
            )}
          >
            #{t.tag}
          </button>
        ))}
      </div>
    </div>
  </div>
);

const CustomPlanFields = ({
  open,
  onOpenChange,
  title,
  onTitle,
  intent,
  onIntent,
  placeholder,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly title: string;
  readonly onTitle: (v: string) => void;
  readonly intent: string;
  readonly onIntent: (v: string) => void;
  readonly placeholder: string;
}) => (
  <Collapsible open={open} onOpenChange={onOpenChange}>
    <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-meta font-medium text-ink-2 hover:text-ink">
      <ChevronDownIcon className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      Customize goal title & personal note (optional)
    </CollapsibleTrigger>
    <CollapsibleContent className="mt-3 grid gap-3 rounded-card bg-sunken/70 p-3.5">
      <Field>
        <Label htmlFor="plan-title">Goal title</Label>
        <Input
          id="plan-title"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder={placeholder}
        />
      </Field>
      <Field>
        <Label htmlFor="plan-intent">Why this matters to your practice</Label>
        <Textarea
          id="plan-intent"
          rows={2}
          value={intent}
          onChange={(e) => onIntent(e.target.value)}
          placeholder="e.g. I want my first client meetings to uncover real goals before talking products."
        />
      </Field>
    </CollapsibleContent>
  </Collapsible>
);

const PickerSkillList = ({
  loading,
  skills,
  focus,
  onToggle,
  onLevel,
}: {
  readonly loading: boolean;
  readonly skills: ReadonlyArray<SkillCard>;
  readonly focus: ReadonlyArray<{ readonly skillId: SkillId; readonly targetLevel: Level }>;
  readonly onToggle: (id: SkillId) => void;
  readonly onLevel: (id: SkillId, level: Level) => void;
}) =>
  loading ? (
    <div className="grid gap-2">
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  ) : (
    <div className="grid max-h-[300px] gap-2 overflow-y-auto pr-1">
      {skills.map((s) => {
        const chosen = focus.find((f) => f.skillId === s.id);
        return (
          <SkillPickerCard
            key={s.id}
            skill={s}
            targetLevel={chosen?.targetLevel ?? null}
            maxed={!chosen && focus.length >= 3}
            onToggle={() => onToggle(s.id)}
            onLevel={(l) => onLevel(s.id, l)}
          />
        );
      })}
      {skills.length === 0 ? (
        <p className="py-6 text-center text-ui text-ink-3">No skills match those filters.</p>
      ) : null}
    </div>
  );

const buildPresets = (
  skills: ReadonlyArray<SkillCard>,
  insights:
    | {
        readonly rareCombos: ReadonlyArray<{
          readonly skills: readonly [{ id: SkillId }, { id: SkillId }];
        }>;
        readonly lackingSkillIds: ReadonlyArray<SkillId>;
      }
    | undefined,
) => {
  const corePresetIds = skills
    .filter((s) => s.tier === 'core' && (s.myHighestLevel ?? 0) < 3)
    .slice(0, 3)
    .map((s) => s.id);
  const topCombo = insights?.rareCombos[0];
  const topComboIds = topCombo ? [topCombo.skills[0].id, topCombo.skills[1].id] : [];
  const gapPresetIds = (insights?.lackingSkillIds ?? []).slice(0, 2);
  return { corePresetIds, topComboIds, gapPresetIds };
};

/**
 * Catalog-powered focus skill builder: supports Core/Common filters, tags,
 * 1-click strategy presets (Core essentials, Rare combo, Fill firm gaps), and
 * live rare-combo synergy feedback.
 */
export const FocusSkillsDialog = ({
  open,
  onClose,
  existingPlan = null,
  initialSkillIds,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly existingPlan?: PlanView | null;
  readonly initialSkillIds?: ReadonlyArray<SkillId> | undefined;
}) => {
  const skillsQuery = useQuery({
    ...queryOptions('catalog', 'skills', { query: {} }),
    enabled: open,
  });
  const insightsQuery = useQuery({
    ...queryOptions('catalog', 'insights', undefined),
    enabled: open,
  });
  const skills = skillsQuery.data ?? [];
  const insights = insightsQuery.data;

  const [focus, setFocus] = useState<ReadonlyArray<{ skillId: SkillId; targetLevel: Level }>>(() =>
    buildInitialFocus(existingPlan, initialSkillIds),
  );
  const [filter, setFilter] = useState<PickerFilter>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [title, setTitle] = useState(existingPlan?.title ?? '');
  const [intent, setIntent] = useState(existingPlan?.intent ?? '');
  const [showCustom, setShowCustom] = useState(false);

  const create = useApiMutation('development', 'createPlan', {
    onSuccess: () => {
      toast.success('Focus skills saved — you’re ready to close your mastery rings.');
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

  const applyPreset = (ids: ReadonlyArray<SkillId>) =>
    setFocus(ids.slice(0, 3).map((skillId) => ({ skillId, targetLevel: 3 as Level })));

  const { corePresetIds, topComboIds, gapPresetIds } = buildPresets(skills, insights);

  const visible = skills.filter((s) => matchesFilter(s, filter, selectedTag, q));
  const matchedCombo = findMatchingRareCombo(
    focus.map((f) => f.skillId),
    insights,
  );
  const pending = create.isPending || update.isPending;
  const valid = focus.length >= 1 && focus.length <= 3;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const finalTitle = title.trim() || autoTitle(focus, skills);
    if (existingPlan) {
      update.mutate({
        params: { id: existingPlan.id },
        payload: { title: finalTitle, intent: intent.trim(), focusSkills: [...focus] },
      });
      return;
    }
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
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={existingPlan ? 'Edit focus skills' : 'Build your skill focus'}
      description="Pick 1–3 skills to level up. Filter by Core, Common, tags, or apply a smart combo."
    >
      <form className="grid gap-4" onSubmit={submit}>
        <PickerControls
          q={q}
          onQ={setQ}
          filter={filter}
          onFilter={setFilter}
          selectedTag={selectedTag}
          onTag={setSelectedTag}
          tags={insights?.tags ?? []}
          corePresetIds={corePresetIds}
          topComboIds={topComboIds}
          gapPresetIds={gapPresetIds}
          onPreset={applyPreset}
        />

        <PickerSkillList
          loading={skillsQuery.isPending}
          skills={visible}
          focus={focus}
          onToggle={toggle}
          onLevel={setLevel}
        />

        {matchedCombo ? (
          <div className="flex items-start gap-2 rounded-card border border-brass/50 bg-brass-soft/50 px-3 py-2 text-meta text-brass-ink">
            <CatalystArc size={14} className="mt-0.5" />
            <span>
              <strong className="font-semibold">Rare combo selected:</strong>{' '}
              {matchedCombo.rationale}
            </span>
          </div>
        ) : null}

        <CustomPlanFields
          open={showCustom}
          onOpenChange={setShowCustom}
          title={title}
          onTitle={setTitle}
          intent={intent}
          onIntent={setIntent}
          placeholder={autoTitle(focus, skills)}
        />

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="font-mono text-meta text-ink-3 tabular">
            {focus.length} of 3 selected
          </span>
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
