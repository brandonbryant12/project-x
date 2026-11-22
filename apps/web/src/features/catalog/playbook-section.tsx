import type { SkillDetail } from '@repo/api';
import { RESOURCE_KINDS, type Level, type ResourceKind, type SkillResource } from '@repo/domain';
import {
  Button,
  Card,
  cn,
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  Pill,
  SectionLabel,
  Textarea,
  toast,
} from '@repo/ui';
import {
  BookOpenIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HeadphonesIcon,
  PlayCircleIcon,
  PlusIcon,
  ScrollTextIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { levelName } from '@/lib/format.ts';

const KIND_META: Record<
  ResourceKind,
  { readonly label: string; readonly icon: typeof BookOpenIcon }
> = {
  playbook: { label: 'Playbook', icon: BookOpenIcon },
  script: { label: 'Script', icon: ScrollTextIcon },
  sample_call: { label: 'Sample call', icon: HeadphonesIcon },
  guide: { label: 'Guide', icon: FileTextIcon },
  video: { label: 'Video', icon: PlayCircleIcon },
  course: { label: 'Course', icon: BookOpenIcon },
};

const AddResourceDialog = ({
  skill,
  open,
  onClose,
}: {
  readonly skill: SkillDetail;
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const [level, setLevel] = useState<Level>(3);
  const [kind, setKind] = useState<ResourceKind>('playbook');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [url, setUrl] = useState('');
  const [minutes, setMinutes] = useState('10');

  const add = useApiMutation('catalog', 'addResource', {
    onSuccess: () => {
      toast.success('Playbook resource added.');
      setTitle('');
      setSummary('');
      setUrl('');
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2) return;
    const parsedMin = Number(minutes);
    add.mutate({
      params: { id: skill.id },
      payload: {
        level,
        kind,
        title: title.trim(),
        summary: summary.trim(),
        url: url.trim() || null,
        durationMinutes: Number.isInteger(parsedMin) && parsedMin > 0 ? parsedMin : null,
      },
    });
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add level-up resource"
      description={`Attach a firm playbook, script, sample call, or guide to help advisors level up in ${skill.name}.`}
    >
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <Label htmlFor="res-level">Target level</Label>
            <NativeSelect
              id="res-level"
              value={level}
              onChange={(e) => setLevel(Number(e.target.value) as Level)}
            >
              {[1, 2, 3, 4].map((l) => (
                <option key={l} value={l}>
                  Level {l} · {levelName(l)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <Label htmlFor="res-kind">Resource type</Label>
            <NativeSelect
              id="res-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ResourceKind)}
            >
              {RESOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_META[k].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <Field>
          <Label htmlFor="res-title">Title</Label>
          <Input
            id="res-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. 5 open discovery prompts for new households"
            maxLength={140}
          />
        </Field>

        <Field>
          <Label htmlFor="res-summary">How to use it · optional</Label>
          <Textarea
            id="res-summary"
            rows={2}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Short guidance on when to apply this before or after a client meeting."
            maxLength={400}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
          <Field>
            <Label htmlFor="res-url">Link · optional</Label>
            <Input
              id="res-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://intranet.firm.com/playbooks/..."
            />
            <FieldHint>Optional internal wiki, SharePoint, or LMS link.</FieldHint>
          </Field>
          <Field>
            <Label htmlFor="res-min">Minutes</Label>
            <Input
              id="res-min"
              type="number"
              min={1}
              max={240}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={title.trim().length < 2 || add.isPending}
          >
            {add.isPending ? 'Adding…' : 'Add resource'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

const ResourceCard = ({
  resource,
  canEdit,
  removing,
  onRemove,
}: {
  readonly resource: SkillResource;
  readonly canEdit: boolean;
  readonly removing: boolean;
  readonly onRemove: () => void;
}) => {
  const [confirming, setConfirming] = useState(false);
  const meta = KIND_META[resource.kind];
  const Icon = meta.icon;
  return (
    <li className="flex items-start gap-3.5 px-4 py-4 transition-colors duration-150 hover:bg-sunken/45 md:px-5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control bg-primary-soft text-primary-ink">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {resource.url ? (
            <a
              href={resource.url}
              target="_blank"
              rel="noreferrer"
              className="group/link inline-flex items-center gap-1 text-ui font-semibold text-ink transition-colors hover:text-primary-ink hover:underline"
            >
              {resource.title}
              <ExternalLinkIcon className="size-3.5 text-ink-3 transition-transform duration-150 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-primary-ink" />
            </a>
          ) : (
            <span className="text-ui font-semibold text-ink">{resource.title}</span>
          )}
          <Pill tone="outline">L{resource.level}</Pill>
          <Pill tone="neutral">{meta.label}</Pill>
          {resource.durationMinutes ? (
            <span className="font-mono text-meta text-ink-3 tabular">
              {resource.durationMinutes} min
            </span>
          ) : null}
        </div>
        {resource.summary ? <p className="text-ui text-ink-2">{resource.summary}</p> : null}
      </div>
      {canEdit && confirming ? (
        <div className="flex shrink-0 animate-fade-up items-center gap-1">
          <Button type="button" variant="danger" size="sm" disabled={removing} onClick={onRemove}>
            Remove
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
        </div>
      ) : null}
      {canEdit && !confirming ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${resource.title}`}
          disabled={removing}
          onClick={() => setConfirming(true)}
        >
          <Trash2Icon className="size-4 text-ink-3" />
        </Button>
      ) : null}
    </li>
  );
};

/** Level-Up Playbooks section on individual Skill pages with inline resource customization. */
export const SkillPlaybooksSection = ({
  skill,
  canEdit,
}: {
  readonly skill: SkillDetail;
  readonly canEdit: boolean;
}) => {
  const [levelFilter, setLevelFilter] = useState<'all' | Level>('all');
  const [adding, setAdding] = useState(false);

  const remove = useApiMutation('catalog', 'removeResource', {
    onSuccess: () => toast.success('Resource removed.'),
  });

  const visible =
    levelFilter === 'all'
      ? skill.resources.toSorted((a, b) => a.level - b.level)
      : skill.resources.filter((r) => r.level === levelFilter);

  return (
    <section className="grid gap-3" aria-labelledby="playbooks-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel id="playbooks-heading">
          Level-up playbooks &amp; resources ({skill.resources.length})
        </SectionLabel>
        {canEdit ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <PlusIcon /> Add resource
          </Button>
        ) : null}
      </div>

      {skill.resources.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {(['all', 1, 2, 3, 4] as const).map((lvl) => (
            <button
              key={String(lvl)}
              type="button"
              aria-pressed={levelFilter === lvl}
              onClick={() => setLevelFilter(lvl)}
              className={cn(
                'h-7 cursor-pointer rounded-full border px-2.5 text-meta font-medium transition-colors',
                levelFilter === lvl
                  ? 'border-primary bg-primary-soft text-primary-ink'
                  : 'border-line text-ink-3 hover:bg-sunken hover:text-ink',
              )}
            >
              {lvl === 'all' ? 'All levels' : `Level ${lvl}`}
            </button>
          ))}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <Card>
          <ul className="divide-y divide-line">
            {visible.map((r) => (
              <ResourceCard
                key={r.id}
                resource={r}
                canEdit={canEdit}
                removing={remove.isPending}
                onRemove={() => remove.mutate({ params: { id: skill.id, resourceId: r.id } })}
              />
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="grid gap-2 p-5 text-ui text-ink-2">
          <p className="font-medium text-ink">No playbook resources for this level yet</p>
          <p>
            {canEdit
              ? 'Add a conversation script, sample call checklist, or internal guide so advisors know how to practice this level.'
              : 'Your practice team or coaches can add scripts, sample calls, and guides here.'}
          </p>
        </Card>
      )}

      <AddResourceDialog skill={skill} open={adding} onClose={() => setAdding(false)} />
    </section>
  );
};
