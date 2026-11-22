import type { BadgeCriteriaPolicy, TenantPolicyView } from '@repo/api';
import { DEFAULT_BADGE_CRITERIA, STRICT_BADGE_CRITERIA } from '@repo/domain';
import {
  Button,
  Card,
  CatalystArc,
  cn,
  Field,
  FieldHint,
  Input,
  Label,
  MasteryRing,
  NativeSelect,
  Pill,
  SectionLabel,
  toast,
} from '@repo/ui';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, CheckIcon, ShieldCheckIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Page, PageHeader } from '@/components/page.tsx';
import { useApiMutation } from '@/lib/api.ts';

const PRESETS = [
  {
    key: 'poc' as const,
    name: 'Fast Pilot (POC)',
    tagline: 'Low-friction adoption for new teams',
    criteria: DEFAULT_BADGE_CRITERIA,
    windowDays: 14,
  },
  {
    key: 'strict' as const,
    name: 'Enterprise Rigor',
    tagline: 'Multi-observer validation over 4+ weeks',
    criteria: STRICT_BADGE_CRITERIA,
    windowDays: 14,
  },
] as const;

const policySentence = (c: BadgeCriteriaPolicy) => {
  const parts = [
    `${c.minDemonstrations} ${c.minDemonstrations === 1 ? 'observation' : 'observations'}`,
    c.minObservers > 1 ? `from at least ${c.minObservers} distinct observers` : null,
    c.minFirstHandShare > 0
      ? `at least ${Math.round(c.minFirstHandShare * 100)}% seen first-hand`
      : null,
    c.minSpanDays > 0 ? `across ${c.minSpanDays}+ days` : null,
  ].filter(Boolean);
  return parts.join(' · ');
};

const PolicyNumberControl = ({
  id,
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly onChange: (n: number) => void;
}) => (
  <Field>
    <div className="flex items-baseline justify-between gap-2">
      <Label htmlFor={id}>{label}</Label>
      <span className="font-mono text-ui font-semibold text-primary-ink tabular">{value}</span>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
    />
    <FieldHint>{hint}</FieldHint>
  </Field>
);

const RigorPresetsSection = ({
  criteria,
  canEdit,
  onSelect,
}: {
  readonly criteria: BadgeCriteriaPolicy;
  readonly canEdit: boolean;
  readonly onSelect: (preset: (typeof PRESETS)[number]) => void;
}) => (
  <section className="grid gap-3">
    <SectionLabel>Rigor presets</SectionLabel>
    <div className="grid gap-3 sm:grid-cols-2">
      {PRESETS.map((p) => {
        const selected =
          criteria.minDemonstrations === p.criteria.minDemonstrations &&
          criteria.minObservers === p.criteria.minObservers &&
          criteria.minSpanDays === p.criteria.minSpanDays;
        return (
          <button
            key={p.key}
            type="button"
            disabled={!canEdit}
            onClick={() => onSelect(p)}
            className={cn(
              'grid cursor-pointer gap-1.5 rounded-card border p-4 text-left transition-colors disabled:cursor-not-allowed',
              selected
                ? 'border-primary bg-primary-soft/45 ring-1 ring-primary/25'
                : 'border-line bg-surface hover:border-line-strong',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-ui font-semibold text-ink">{p.name}</span>
              {selected ? <CheckIcon className="size-4 text-primary-ink" /> : null}
            </div>
            <p className="text-meta text-ink-2">{p.tagline}</p>
            <p className="font-mono text-[11px] text-ink-3">{policySentence(p.criteria)}</p>
          </button>
        );
      })}
    </div>
  </section>
);

const ThresholdsSection = ({
  criteria,
  windowDays,
  canEdit,
  onCriteria,
  onMinDemos,
  onWindowDays,
}: {
  readonly criteria: BadgeCriteriaPolicy;
  readonly windowDays: number;
  readonly canEdit: boolean;
  readonly onCriteria: (updater: (c: BadgeCriteriaPolicy) => BadgeCriteriaPolicy) => void;
  readonly onMinDemos: (n: number) => void;
  readonly onWindowDays: (n: number) => void;
}) => (
  <section className="grid gap-3">
    <SectionLabel>Badge &amp; mastery ring thresholds</SectionLabel>
    <Card className="grid gap-5 p-5">
      <PolicyNumberControl
        id="min-demos"
        label="Minimum published observations"
        hint="How many verified observations at or above a level close the ring."
        value={criteria.minDemonstrations}
        min={1}
        max={8}
        disabled={!canEdit}
        onChange={onMinDemos}
      />
      <PolicyNumberControl
        id="min-observers"
        label="Minimum distinct observers"
        hint="Set to 2+ so no single friendly observer can award a badge alone."
        value={criteria.minObservers}
        min={1}
        max={Math.min(4, criteria.minDemonstrations)}
        disabled={!canEdit}
        onChange={(n) => onCriteria((c) => ({ ...c, minObservers: n }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="first-hand-share">First-hand observation share</Label>
          <NativeSelect
            id="first-hand-share"
            disabled={!canEdit}
            value={String(criteria.minFirstHandShare)}
            onChange={(e) =>
              onCriteria((c) => ({ ...c, minFirstHandShare: Number(e.target.value) }))
            }
          >
            <option value="0">Optional (debriefs allowed)</option>
            <option value="0.5">At least 50% first-hand</option>
            <option value="0.75">At least 75% first-hand</option>
            <option value="1">100% first-hand required</option>
          </NativeSelect>
          <FieldHint>Saw the work live or reviewed a recording/artifact.</FieldHint>
        </Field>
        <Field>
          <Label htmlFor="span-days">Minimum time span (days)</Label>
          <Input
            id="span-days"
            type="number"
            min={0}
            max={180}
            disabled={!canEdit}
            value={criteria.minSpanDays}
            onChange={(e) =>
              onCriteria((c) => ({
                ...c,
                minSpanDays: Math.max(0, Number(e.target.value)),
              }))
            }
          />
          <FieldHint>0 for immediate pilot unlock; 28+ proves sustained habit.</FieldHint>
        </Field>
      </div>
      <PolicyNumberControl
        id="window-days"
        label="Observation logging window (days)"
        hint="How far back an advisor or observer can log a meeting."
        value={windowDays}
        min={3}
        max={60}
        disabled={!canEdit}
        onChange={onWindowDays}
      />
    </Card>
  </section>
);

const PolicyPreviewAside = ({ criteria }: { readonly criteria: BadgeCriteriaPolicy }) => (
  <aside className="grid content-start gap-6">
    <Card className="grid gap-4 border-brass/50 bg-brass-soft/35 p-5">
      <div className="flex items-center gap-3">
        <MasteryRing
          level={1}
          current={Math.max(1, criteria.minDemonstrations - 1)}
          required={criteria.minDemonstrations}
          size="md"
        />
        <div>
          <p className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-brass-ink uppercase">
            Live policy preview
          </p>
          <p className="text-ui font-semibold text-ink">How a ring unlocks</p>
        </div>
      </div>
      <p className="text-ui text-ink-2">{policySentence(criteria)}.</p>
      <p className="inline-flex items-center gap-1.5 text-meta text-ink-3">
        <CatalystArc size={12} /> Applies immediately to all active progress rings.
      </p>
    </Card>

    <Card className="grid gap-3 p-5">
      <p className="text-ui font-semibold text-ink">Skill Catalog Authoring Studio</p>
      <p className="text-ui text-ink-2">
        Author new firm skills, assign Core/Common tiers and tags, publish new versions, and curate
        level-up playbooks directly inside the Skill Catalog.
      </p>
      <Button asChild variant="secondary" size="sm" className="justify-self-start">
        <Link to="/catalog/skills">
          Open Skill Catalog Studio <ArrowRightIcon className="size-3.5" />
        </Link>
      </Button>
    </Card>
  </aside>
);

export const PolicyScreen = ({ policy }: { readonly policy: TenantPolicyView }) => {
  const [criteria, setCriteria] = useState<BadgeCriteriaPolicy>(policy.badgeCriteria);
  const [windowDays, setWindowDays] = useState(policy.observationWindowDays);
  const [reason, setReason] = useState('');

  const save = useApiMutation('admin', 'updatePolicy', {
    onSuccess: () => {
      toast.success('Program policy saved and recorded in the audit trail.');
      setReason('');
    },
  });

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setCriteria({ ...p.criteria });
    setWindowDays(p.windowDays);
  };

  const setMinDemos = (n: number) =>
    setCriteria((c) => ({
      ...c,
      minDemonstrations: n,
      minObservers: Math.min(c.minObservers, n),
    }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!policy.canEdit) return;
    save.mutate({
      payload: {
        badgeCriteria: criteria,
        observationWindowDays: windowDays,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
    });
  };

  return (
    <Page>
      <div className="grid gap-8">
        <PageHeader
          title="Program policy & rigor"
          description={`Tune how skill rings close and badges are earned across ${policy.tenantName}. Every change is audited.`}
          actions={
            <Pill tone="info">
              <ShieldCheckIcon className="mr-1 size-3.5" />
              Active: {policy.preset.toUpperCase()}
            </Pill>
          }
        />

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <form className="grid gap-6" onSubmit={submit}>
            <RigorPresetsSection
              criteria={criteria}
              canEdit={policy.canEdit}
              onSelect={applyPreset}
            />
            <ThresholdsSection
              criteria={criteria}
              windowDays={windowDays}
              canEdit={policy.canEdit}
              onCriteria={setCriteria}
              onMinDemos={setMinDemos}
              onWindowDays={setWindowDays}
            />

            {policy.canEdit ? (
              <Card className="grid gap-4 p-5">
                <Field>
                  <Label htmlFor="policy-reason">Audit note · optional</Label>
                  <Input
                    id="policy-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Moving Q3 branch pilot to 2-observer requirement"
                    maxLength={240}
                  />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" disabled={save.isPending}>
                    <SlidersHorizontalIcon />
                    {save.isPending ? 'Saving policy…' : 'Save program policy'}
                  </Button>
                </div>
              </Card>
            ) : (
              <p className="text-ui text-ink-3">
                Read-only view. Only tenant admins can change firm-wide policy settings.
              </p>
            )}
          </form>

          <PolicyPreviewAside criteria={criteria} />
        </div>
      </div>
    </Page>
  );
};
