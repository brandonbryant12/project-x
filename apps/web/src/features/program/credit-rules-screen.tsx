import type { CreditPolicyAdminView, CreditPolicyValues } from '@repo/api';
import {
  Button,
  Card,
  Checkbox,
  Field,
  FieldHint,
  Input,
  Label,
  Pill,
  SectionLabel,
  Textarea,
  toast,
} from '@repo/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Page, PageHeader } from '@/components/page.tsx';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { describeError, useApiMutation } from '@/lib/api.ts';
import { formatDate } from '@/lib/format.ts';
import {
  BADGE,
  OVERRIDE_RANGE,
  WORTH,
  consequences,
  differences,
  display,
  fieldLabel,
  formFrom,
  historyValue,
  policyFrom,
  problemsOf,
  workedExample,
  type FieldSpec,
  type PolicyField,
  type PolicyForm,
  valueOf,
} from './credit-rules.ts';
import { ChangeHistory } from './parts.tsx';

const MIN_REASON = 10;

const DefaultNote = ({
  isDefault,
  workingDefault,
}: {
  readonly isDefault: boolean;
  readonly workingDefault: string;
}) =>
  isDefault ? (
    <Pill tone="outline" className="w-fit">
      Working default
    </Pill>
  ) : (
    <span className="text-meta text-ink-3">Working default: {workingDefault}</span>
  );

/** The domain speaks of a share from 0 to 1; the form edits it as a percentage. */
const problemText = (spec: FieldSpec, message: string | undefined) =>
  message && spec.percent ? 'Use a percentage from 0 to 100.' : message;

const OverridesSwitch = ({
  checked,
  onChange,
  problem,
}: {
  readonly checked: boolean;
  readonly onChange: (on: boolean) => void;
  readonly problem: string | undefined;
}) => (
  <div className="flex items-start gap-3 py-4">
    <Checkbox
      id="policy-overrides"
      checked={checked}
      onCheckedChange={(c) => onChange(c === true)}
      aria-describedby="policy-overrides-hint"
      className="mt-0.5"
    />
    <div className="grid gap-1">
      <Label htmlFor="policy-overrides">An activity may have its own value</Label>
      <FieldHint id="policy-overrides-hint">
        {problem ?? 'When off, values already given to activities stop applying.'}
      </FieldHint>
    </div>
  </div>
);

const NumberRow = ({
  spec,
  value,
  onChange,
  problem,
  workingDefault,
}: {
  readonly spec: FieldSpec;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly problem: string | undefined;
  readonly workingDefault: string;
}) => {
  const id = `policy-${spec.field}`;
  const isDefault = value.trim() === workingDefault;
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-6">
      <div className="grid content-start gap-1">
        <Label htmlFor={id}>{spec.label}</Label>
        <FieldHint id={`${id}-hint`}>{spec.hint}</FieldHint>
      </div>
      <div className="grid content-start gap-1.5">
        <div className="flex items-center gap-2">
          <Input
            id={id}
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-hint${problem ? ` ${id}-problem` : ''}`}
            className="w-24 tabular"
          />
          <span className="text-meta text-ink-3">{spec.unit}</span>
        </div>
        {problem ? (
          <p id={`${id}-problem`} className="text-meta text-danger-ink">
            {problem}
          </p>
        ) : (
          <DefaultNote isDefault={isDefault} workingDefault={workingDefault} />
        )}
      </div>
    </div>
  );
};

const Group = ({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
}) => (
  <section className="grid gap-3" aria-label={title}>
    <div className="grid gap-1">
      <SectionLabel>{title}</SectionLabel>
      <p className="text-ui text-ink-2">{description}</p>
    </div>
    <Card className="px-5">
      <div className="divide-y divide-line">{children}</div>
    </Card>
  </section>
);

const ConfirmSave = ({
  open,
  onClose,
  view,
  proposed,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly view: CreditPolicyAdminView;
  readonly proposed: CreditPolicyValues;
}) => {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const save = useApiMutation('program', 'saveCreditPolicy', {
    invalidates: ['program', 'catalog', 'development', 'support'],
    onSuccess: (saved) => {
      toast.success(`Credit rules saved as version ${saved.version}.`);
      setReason('');
      onClose();
    },
    onError: (e) => {
      setError(describeError(e));
      setStale((e as { _tag?: string })._tag === 'Conflict');
    },
  });
  const changes = differences(view.stored, proposed);
  const effects = consequences(proposed, view.defaults, view.stored);
  const ready = reason.trim().length >= MIN_REASON;
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Save the credit rules"
      description={`This becomes version ${view.version + 1}. It applies to observations signed from now on.`}
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          setError(null);
          save.mutate({
            payload: { expectedVersion: view.version, policy: proposed, reason: reason.trim() },
          });
        }}
      >
        <section className="grid gap-2" aria-label="What changes">
          <SectionLabel>What changes</SectionLabel>
          {changes.length === 0 ? (
            <p className="text-ui text-ink-2">No value changes. The rules are saved as they are.</p>
          ) : (
            <ul className="grid gap-1">
              {changes.map((c) => (
                <li key={c.label} className="text-ui text-ink-2">
                  {c.label}: {c.before} → <span className="font-medium text-ink">{c.after}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {effects.length > 0 ? (
          <section
            className="grid gap-2 rounded-control bg-warning-soft px-4 py-3"
            aria-label="Consequences"
          >
            <p className="text-ui font-medium text-warning-ink">Before you save</p>
            <ul className="grid list-disc gap-1 pl-5 text-ui text-warning-ink">
              {effects.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="text-ui text-ink-2">
          Saving never re-evaluates badges already awarded and awards none by itself. A badge that
          becomes reachable is awarded with the person’s next signed observation of that skill.
          Credit already signed keeps the points it was signed with.
        </p>
        <Field>
          <Label htmlFor="policy-reason">Why are you changing them?</Label>
          <Textarea
            id="policy-reason"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby="policy-reason-hint"
          />
          <FieldHint id="policy-reason-hint">
            At least {MIN_REASON} characters. Kept with the change in the record.
          </FieldHint>
        </Field>
        {error ? (
          <div role="alert" className="grid gap-2">
            <p className="text-ui text-danger-ink">{error}</p>
            {stale ? (
              <>
                <p className="text-ui text-ink-2">
                  Loading the latest version replaces the values you entered here. Note them first
                  if you want to enter them again.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-fit"
                  onClick={() => {
                    void qc.invalidateQueries({ queryKey: ['program', 'creditPolicy'] });
                    onClose();
                  }}
                >
                  Discard my values and load the latest
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Go back
          </Button>
          <Button type="submit" variant="primary" disabled={!ready || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save credit rules'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

/**
 * Credit rules (design 2026-11-17 §2): the tenant's points and badge rules,
 * replaced as a whole with a reason. The wording beside each field describes
 * the calculation actually used. A broken stored policy is shown with its
 * problems; saving a valid one is the only repair.
 */
export const CreditRulesScreen = ({ view }: { readonly view: CreditPolicyAdminView }) => {
  const [form, setForm] = useState<PolicyForm>(() => formFrom(view.stored));
  const [loadedVersion, setLoadedVersion] = useState(view.version);
  const [confirming, setConfirming] = useState(false);
  // A newer version arrived (after a save, or "load the latest"): start from it.
  if (loadedVersion !== view.version) {
    setLoadedVersion(view.version);
    setForm(formFrom(view.stored));
  }
  const proposed = policyFrom(form, view.stored);
  const problems = problemsOf(proposed);
  const valid = problems.size === 0;
  const dirty = JSON.stringify(form) !== JSON.stringify(formFrom(view.stored));
  const set = (field: PolicyField) => (value: string) =>
    setForm((f) => ({ ...f, values: { ...f.values, [field]: value } }));
  const row = (spec: FieldSpec) => (
    <NumberRow
      key={spec.field}
      spec={spec}
      value={form.values[spec.field]}
      onChange={set(spec.field)}
      problem={problemText(spec, problems.get(spec.field)?.message)}
      workingDefault={display(spec.field, valueOf(view.defaults, spec.field))}
    />
  );
  const last = view.history[0];
  const effects = valid ? consequences(proposed, view.defaults, view.stored) : [];
  return (
    <Page width="reading">
      <PageHeader
        eyebrow="Program"
        title="Credit rules"
        description={
          view.valid
            ? `What signed observations are worth and what a badge needs. Version ${view.version}${
                last
                  ? `, last changed ${formatDate(last.at, { year: 'numeric' })}${last.actor ? ` by ${last.actor.displayName}` : ''}.`
                  : ', the working defaults the program started with.'
              }`
            : 'The stored credit rules are incomplete or invalid.'
        }
      />
      {view.valid ? null : (
        <div role="alert" className="mb-8 grid gap-2 rounded-card bg-warning-soft px-5 py-4">
          <p className="text-ui font-medium text-warning-ink">
            Signing and progress are stopped until valid rules are saved.
          </p>
          <ul className="grid list-disc gap-1 pl-5 text-ui text-warning-ink">
            {view.problems.map((p) => (
              <li key={p.field}>
                {fieldLabel(p.field)}: {p.message}
              </li>
            ))}
          </ul>
          <p className="text-ui text-warning-ink">
            Nothing has been filled in for you. Enter every value below and save with a reason.
          </p>
        </div>
      )}
      <form
        className="grid gap-10"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setConfirming(true);
        }}
      >
        <Group
          title="What a signed observation is worth"
          description="Points are fixed when an observation is signed. A later change never alters credit already signed."
        >
          {WORTH.map(row)}
        </Group>
        <Group
          title="What a badge needs"
          description="Every criterion must hold. Badges at levels 2 and 3 are awarded when an observation is signed."
        >
          {BADGE.map(row)}
        </Group>
        <Group
          title="Individual activities"
          description="A coach who agreed the plan, or a program owner, may give one planned activity its own value before its work is observed."
        >
          <OverridesSwitch
            checked={form.overridesEnabled === true}
            onChange={(on) => setForm((f) => ({ ...f, overridesEnabled: on }))}
            problem={problems.get('activityOverrides.enabled')?.message}
          />
          {OVERRIDE_RANGE.map(row)}
        </Group>

        <section className="grid gap-3" aria-labelledby="example">
          <SectionLabel id="example">With these values</SectionLabel>
          {valid ? (
            <Card className="grid gap-2 px-5 py-4">
              {workedExample(proposed).map((line) => (
                <p key={line} className="text-ui text-ink-2">
                  {line}
                </p>
              ))}
            </Card>
          ) : (
            <p className="text-ui text-ink-3">Fix the values marked above to see an example.</p>
          )}
          {effects.length > 0 ? (
            <ul className="grid list-disc gap-1 pl-5 text-ui text-warning-ink">
              {effects.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!valid || (!dirty && view.valid)}>
            Review and save
          </Button>
          {dirty ? (
            <Button type="button" variant="ghost" onClick={() => setForm(formFrom(view.stored))}>
              Undo my changes
            </Button>
          ) : null}
          <p className="text-meta text-ink-3">Saving re-evaluates no badge already awarded.</p>
        </div>
      </form>

      <div className="mt-12">
        <ChangeHistory
          history={view.history}
          label={fieldLabel}
          format={historyValue}
          empty="No changes yet: these are the values the program started with."
        />
      </div>
      {valid ? (
        <ConfirmSave
          open={confirming}
          onClose={() => setConfirming(false)}
          view={view}
          proposed={proposed}
        />
      ) : null}
    </Page>
  );
};
