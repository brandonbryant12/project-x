import type {
  CatalogItemEventType,
  ProgramSkillRow,
  ProgramTemplateDetail,
  ProgramTemplateRow,
  ProgramTemplateSkill,
  TemplateInput,
} from '@repo/api';
import {
  INTERACTION_KINDS,
  type InteractionKind,
  type SkillId,
  type SkillRole,
} from '@repo/domain';
import {
  Button,
  Card,
  EmptyState,
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  SectionLabel,
  Textarea,
  toast,
} from '@repo/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader, SkillChip } from '@/components/page.tsx';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { describeError, useApiMutation } from '@/lib/api.ts';
import { kindLabel } from '@/lib/format.ts';
import {
  CatalogActions,
  CatalogStatusPill,
  ChangeHistory,
  parseWhole,
  type TransitionCopy,
} from './parts.tsx';

const ROLE_LABEL: Record<SkillRole, string> = { primary: 'Primary', secondary: 'Secondary' };

/** "Client discovery · primary · 12 points" */
const skillLabel = (s: Pick<ProgramTemplateSkill, 'skill' | 'role' | 'points'>) =>
  `${s.skill.name} · ${s.role}${s.points === null ? '' : ` · ${s.points} points`}`;

const TemplateListRow = ({ template }: { readonly template: ProgramTemplateRow }) => (
  <li>
    <Link
      to="/program/templates/$id"
      params={{ id: template.id }}
      className="grid gap-1.5 px-4 py-4 transition-colors hover:bg-sunken md:px-5"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-ui font-medium text-ink">{template.name}</span>
        <CatalogStatusPill status={template.status} />
      </span>
      <span className="text-meta text-ink-3">
        {kindLabel(template.kind)}
        {template.typicalMinutes ? ` · about ${template.typicalMinutes} min` : ''}
      </span>
      {template.skills.length > 0 ? (
        <span className="flex flex-wrap gap-1.5">
          {template.skills.map((s) => (
            <SkillChip key={s.skill.id} name={skillLabel(s)} />
          ))}
        </span>
      ) : (
        <span className="text-meta text-ink-3">No skills yet</span>
      )}
    </Link>
  </li>
);

const NewTemplateDialog = ({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<InteractionKind>('client_meeting');
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation('program', 'createTemplate', {
    invalidates: ['program'],
    onSuccess: (t) => {
      onClose();
      void navigate({ to: '/program/templates/$id', params: { id: t.id } });
    },
    onError: (e) => setError(describeError(e)),
  });
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="New activity template"
      description="It starts as a draft. Add its skills next, then publish it."
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate({
            payload: {
              name,
              description,
              kind,
              observationTip: null,
              typicalMinutes: null,
              skills: [],
            },
          });
        }}
      >
        <Field>
          <Label htmlFor="new-template-name">Name</Label>
          <Input
            id="new-template-name"
            value={name}
            maxLength={120}
            placeholder="Discovery meeting with a new client"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor="new-template-description">What the work is</Label>
          <Textarea
            id="new-template-description"
            value={description}
            maxLength={600}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-20"
          />
        </Field>
        <Field>
          <Label htmlFor="new-template-kind">Kind of work</Label>
          <NativeSelect
            id="new-template-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as InteractionKind)}
          >
            {INTERACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {error ? (
          <p role="alert" className="text-ui text-danger-ink">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

/** Program · Activity templates: every template in any state, with its skills, roles and values. */
export const ProgramTemplatesScreen = ({
  templates,
}: {
  readonly templates: ReadonlyArray<ProgramTemplateRow>;
}) => {
  const [creating, setCreating] = useState(false);
  const groups = [
    { title: 'Published', items: templates.filter((t) => t.status === 'published') },
    { title: 'Drafts', items: templates.filter((t) => t.status === 'draft') },
    {
      title: 'Retired and discarded',
      items: templates.filter((t) => t.status === 'retired' || t.status === 'discarded'),
    },
  ].filter((g) => g.items.length > 0);
  return (
    <Page>
      <PageHeader
        eyebrow="Program"
        title="Activity templates"
        description="Reusable pieces of real work, each with the skills it builds. A template’s roles and values are copied onto an activity when work is added from it, so a change affects only work added afterwards."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon /> New template
          </Button>
        }
      />
      {groups.length === 0 ? <EmptyState>No activity templates yet.</EmptyState> : null}
      <div className="grid gap-8">
        {groups.map((g) => (
          <section key={g.title} className="grid gap-2" aria-label={g.title}>
            <SectionLabel>
              {g.title} · {g.items.length}
            </SectionLabel>
            <Card>
              <ul className="divide-y divide-line">
                {g.items.map((t) => (
                  <TemplateListRow key={t.id} template={t} />
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
      <NewTemplateDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
};

interface SkillLine {
  readonly key: string;
  readonly skillId: SkillId | '';
  readonly role: SkillRole;
  readonly points: string;
}

let lineKey = 0;
const nextLine = () => `s${++lineKey}`;

const formOf = (t: ProgramTemplateDetail) => ({
  name: t.name,
  description: t.description,
  kind: t.kind,
  observationTip: t.observationTip ?? '',
  typicalMinutes: t.typicalMinutes === null ? '' : String(t.typicalMinutes),
  skills: t.skills.map((s): SkillLine => ({
    key: nextLine(),
    skillId: s.skill.id,
    role: s.role,
    points: s.points === null ? '' : String(s.points),
  })),
});
type Form = ReturnType<typeof formOf>;

const inputOf = (f: Form): TemplateInput => ({
  name: f.name,
  description: f.description,
  kind: f.kind,
  observationTip: f.observationTip.trim() === '' ? null : f.observationTip,
  typicalMinutes: parseWhole(f.typicalMinutes),
  skills: f.skills.flatMap((s) =>
    s.skillId === '' ? [] : [{ skillId: s.skillId, role: s.role, points: parseWhole(s.points) }],
  ),
});

const sameInput = (a: Form, b: Form) => JSON.stringify(inputOf(a)) === JSON.stringify(inputOf(b));

const SkillLines = ({
  lines,
  onChange,
  catalog,
  current,
}: {
  readonly lines: ReadonlyArray<SkillLine>;
  readonly onChange: (lines: ReadonlyArray<SkillLine>) => void;
  readonly catalog: ReadonlyArray<ProgramSkillRow>;
  readonly current: ReadonlyArray<ProgramTemplateSkill>;
}) => {
  const published = catalog.filter((s) => s.status === 'published');
  const set = (key: string, change: Partial<SkillLine>) =>
    onChange(
      lines.map((l) => {
        if (l.key === key) return { ...l, ...change };
        // One primary at most: choosing a new primary makes the old one secondary.
        return change.role === 'primary' && l.role === 'primary' ? { ...l, role: 'secondary' } : l;
      }),
    );
  return (
    <div className="grid gap-3">
      {lines.length === 0 ? (
        <FieldHint>
          Add the skills this work builds. A template needs at least one to be published.
        </FieldHint>
      ) : null}
      <ul className="grid gap-3">
        {lines.map((line, index) => {
          const unavailable = current.find(
            (c) => c.skill.id === line.skillId && c.skillStatus !== 'published',
          );
          const id = `template-skill-${line.key}`;
          return (
            <li
              key={line.key}
              className="grid gap-2 rounded-control border border-line p-3 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_auto] sm:items-end"
            >
              <Field>
                <Label htmlFor={`${id}-skill`}>Skill {index + 1}</Label>
                <NativeSelect
                  id={`${id}-skill`}
                  value={line.skillId}
                  onChange={(e) => set(line.key, { skillId: e.target.value as SkillId })}
                  aria-invalid={unavailable ? true : undefined}
                >
                  <option value="">Choose a skill</option>
                  {unavailable ? (
                    <option value={unavailable.skill.id}>
                      {unavailable.skill.name} ({unavailable.skillStatus})
                    </option>
                  ) : null}
                  {published.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <Label htmlFor={`${id}-role`}>Role</Label>
                <NativeSelect
                  id={`${id}-role`}
                  value={line.role}
                  onChange={(e) => set(line.key, { role: e.target.value as SkillRole })}
                >
                  {(['primary', 'secondary'] as const).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <Label htmlFor={`${id}-points`}>Value</Label>
                <Input
                  id={`${id}-points`}
                  inputMode="numeric"
                  placeholder="Default"
                  value={line.points}
                  onChange={(e) => set(line.key, { points: e.target.value })}
                  className="tabular"
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove skill ${index + 1}`}
                onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
              >
                <Trash2Icon />
              </Button>
              {unavailable ? (
                <p className="text-meta text-danger-ink sm:col-span-4">
                  {unavailable.skill.name} is {unavailable.skillStatus}. Remove it before saving.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() =>
          onChange([
            ...lines,
            {
              key: nextLine(),
              skillId: '',
              role: lines.some((l) => l.role === 'primary') ? 'secondary' : 'primary',
              points: '',
            },
          ])
        }
      >
        <PlusIcon /> Add a skill
      </Button>
      <FieldHint>
        At most one skill is primary: the one the work is mainly about. Leave a value empty to use
        the skill’s or the credit rules’ value.
      </FieldHint>
    </div>
  );
};

const transitionCopy = (t: ProgramTemplateDetail, event: CatalogItemEventType): TransitionCopy => {
  switch (event) {
    case 'PUBLISH':
      return {
        title: `Publish ${t.name}`,
        description: 'People can then add work from it to their plans.',
        consequences: [
          'Its skills, roles and values are copied onto each activity added from it.',
          'Later edits apply only to work added afterwards.',
        ],
        confirm: 'Publish',
        note: 'Note for the record',
      };
    case 'RETIRE':
      return {
        title: `Retire ${t.name}`,
        description: 'This cannot be undone.',
        consequences: [
          'It can no longer be chosen when adding work.',
          'Activities already made from it keep their skills, roles and values.',
        ],
        confirm: 'Retire template',
        note: 'Why it is retired',
      };
    case 'DISCARD':
      return {
        title: `Discard the draft ${t.name}`,
        description: 'It was never published. It stays in the record but can never be published.',
        consequences: [],
        confirm: 'Discard draft',
        note: 'Why it is discarded',
      };
  }
};

/** Program · one activity template: its details and skills, and its publish or retire actions. */
const TemplateDetailsCard = ({
  form,
  onChange,
}: {
  readonly form: Form;
  readonly onChange: (change: Partial<Form>) => void;
}) => (
  <section className="grid gap-3" aria-labelledby="template-details">
    <SectionLabel id="template-details">Details</SectionLabel>
    <Card className="grid gap-4 p-5">
      <Field>
        <Label htmlFor="template-name">Name</Label>
        <Input
          id="template-name"
          value={form.name}
          maxLength={120}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Field>
      <Field>
        <Label htmlFor="template-description">What the work is</Label>
        <Textarea
          id="template-description"
          value={form.description}
          maxLength={600}
          onChange={(e) => onChange({ description: e.target.value })}
          className="min-h-16"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="template-kind">Kind of work</Label>
          <NativeSelect
            id="template-kind"
            value={form.kind}
            onChange={(e) => onChange({ kind: e.target.value as InteractionKind })}
          >
            {INTERACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <Label htmlFor="template-minutes">Typical length</Label>
          <div className="flex items-center gap-2">
            <Input
              id="template-minutes"
              inputMode="numeric"
              value={form.typicalMinutes}
              onChange={(e) => onChange({ typicalMinutes: e.target.value })}
              className="w-24 tabular"
            />
            <span className="text-meta text-ink-3">minutes</span>
          </div>
        </Field>
      </div>
      <Field>
        <Label htmlFor="template-tip">Tip for the observer</Label>
        <Textarea
          id="template-tip"
          value={form.observationTip}
          maxLength={600}
          onChange={(e) => onChange({ observationTip: e.target.value })}
          className="min-h-16"
        />
        <FieldHint>What to watch for. Optional.</FieldHint>
      </Field>
    </Card>
  </section>
);

const TemplateEditorForm = ({
  template,
  catalog,
  form,
  setForm,
  dirty,
}: {
  readonly template: ProgramTemplateDetail;
  readonly catalog: ReadonlyArray<ProgramSkillRow>;
  readonly form: Form;
  readonly setForm: (update: (f: Form) => Form) => void;
  readonly dirty: boolean;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const update = useApiMutation('program', 'updateTemplate', {
    invalidates: ['program', 'catalog'],
    onSuccess: () => {
      toast.success('Saved.');
      setReason('');
    },
    onError: (e) => setError(describeError(e)),
  });
  // Skills, roles and values set what work added from now on is worth: say why they change.
  const valuesChanged =
    JSON.stringify(inputOf(form).skills) !== JSON.stringify(inputOf(formOf(template)).skills);
  const explained = !valuesChanged || reason.trim().length >= 10;
  return (
    <form
      className="grid gap-10"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        update.mutate({
          params: { id: template.id },
          payload: {
            ...inputOf(form),
            version: template.version,
            reason: valuesChanged ? reason.trim() : null,
          },
        });
      }}
    >
      {template.status === 'published' ? (
        <p className="rounded-control bg-info-soft px-4 py-3 text-ui text-info-ink">
          This template is in use. Saving applies to work added from now on; activities already made
          from it keep the skills, roles and values they were given.
        </p>
      ) : null}
      <TemplateDetailsCard
        form={form}
        onChange={(change) => setForm((f) => ({ ...f, ...change }))}
      />
      <section className="grid gap-3" aria-labelledby="template-skills">
        <SectionLabel id="template-skills">Skills this work builds</SectionLabel>
        <Card className="p-5">
          <SkillLines
            lines={form.skills}
            onChange={(skills) => setForm((f) => ({ ...f, skills: [...skills] }))}
            catalog={catalog}
            current={template.skills}
          />
        </Card>
      </section>
      {valuesChanged ? (
        <Field>
          <Label htmlFor="template-reason">Why the skills, roles or values change</Label>
          <Textarea
            id="template-reason"
            aria-describedby="template-reason-hint"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-16"
          />
          <FieldHint id="template-reason-hint">
            At least 10 characters. Kept with the change in its history.
          </FieldHint>
        </Field>
      ) : null}
      <div className="grid gap-2">
        {error ? (
          <p role="alert" className="text-ui text-danger-ink">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!dirty || !explained || update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Save template'}
          </Button>
          {dirty ? (
            <Button type="button" variant="ghost" onClick={() => setForm(() => formOf(template))}>
              Undo my changes
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
};

/** Program · one activity template: its details and skills, and its publish or retire actions. */
export const ProgramTemplateScreen = ({
  template,
  catalog,
}: {
  readonly template: ProgramTemplateDetail;
  readonly catalog: ReadonlyArray<ProgramSkillRow>;
}) => {
  const [form, setForm] = useState(() => formOf(template));
  const [loaded, setLoaded] = useState(template.version);
  if (loaded !== template.version) {
    // A save or transition returned a newer version: start again from it.
    setLoaded(template.version);
    setForm(formOf(template));
  }
  const transition = useApiMutation('program', 'templateTransition', {
    invalidates: ['program', 'catalog'],
    onSuccess: (t) => toast.success(`${t.name} is ${t.status}.`),
    onError: () => undefined,
  });
  const dirty = !sameInput(form, formOf(template));
  return (
    <Page width="reading">
      <PageHeader
        eyebrow={
          <Link to="/program/templates" className="hover:text-ink">
            Program · Activity templates
          </Link>
        }
        title={template.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CatalogStatusPill status={template.status} />
            <span className="text-ui text-ink-3">{kindLabel(template.kind)}</span>
          </span>
        }
        actions={
          <CatalogActions
            actions={template.actions}
            copyFor={(event) => transitionCopy(template, event)}
            unsaved={dirty}
            submit={(event, note) =>
              transition.mutateAsync({
                params: { id: template.id },
                payload: { version: template.version, event, note },
              })
            }
          />
        }
      />
      {template.canEdit ? (
        <TemplateEditorForm
          template={template}
          catalog={catalog}
          form={form}
          setForm={setForm}
          dirty={dirty}
        />
      ) : (
        <Card className="grid gap-3 p-5">
          <p className="text-body text-ink-2">{template.description}</p>
          <div className="flex flex-wrap gap-1.5">
            {template.skills.map((s) => (
              <SkillChip key={s.skill.id} name={skillLabel(s)} />
            ))}
          </div>
        </Card>
      )}
      <div className="mt-12">
        <ChangeHistory history={template.history} empty="No changes recorded yet." />
      </div>
    </Page>
  );
};
