import type {
  CatalogItemEventType,
  LevelDraftInput,
  ProgramSkillDetail,
  ProgramSkillList,
  ProgramSkillRow,
  SkillValuesView,
} from '@repo/api';
import { LEVELS, SKILL_DOMAINS, type Level, type SkillDomain } from '@repo/domain';
import {
  Button,
  Card,
  EmptyState,
  Field,
  FieldHint,
  IndicatorRow,
  Input,
  Label,
  LevelPicker,
  NativeSelect,
  Pill,
  SectionLabel,
  Textarea,
  toast,
} from '@repo/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader } from '@/components/page.tsx';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { describeError, useApiMutation } from '@/lib/api.ts';
import { domainLabel, formatDate, levelName } from '@/lib/format.ts';
import { useIsDesktop } from '@/lib/use-media.ts';
import {
  CatalogActions,
  CatalogStatusPill,
  ChangeHistory,
  parseWhole,
  type TransitionCopy,
} from './parts.tsx';

const VALUE_FIELDS = [
  {
    key: 'primaryPoints',
    label: 'Primary skill',
    hint: 'Points for work where this skill is primary.',
  },
  {
    key: 'secondaryPoints',
    label: 'Secondary skill',
    hint: 'Points for work where it is secondary.',
  },
  { key: 'badgePoints', label: 'Points for a badge', hint: 'The badge total for this skill.' },
  {
    key: 'minPrimaryPoints',
    label: 'Points from primary work',
    hint: 'How many of the badge’s points must come from work where this skill was primary. 0 turns it off. It never asks for more than the badge total: if the total in use is lower, the total applies.',
  },
] as const satisfies ReadonlyArray<{ key: keyof SkillValuesView; label: string; hint: string }>;

const valueSummary = (values: SkillValuesView) => {
  const own = VALUE_FIELDS.filter((f) => values[f.key] !== null).map(
    (f) => `${f.label.toLowerCase()} ${values[f.key]}`,
  );
  return own.length > 0 ? `Own values: ${own.join(' · ')}` : 'Uses the credit rules’ values';
};

const versionLine = (skill: ProgramSkillRow) => {
  const parts = [
    skill.currentVersion === null ? 'Not published yet' : `Version ${skill.currentVersion}`,
  ];
  if (skill.hasDraft && skill.currentVersion !== null && skill.status === 'published')
    parts.push('unpublished changes');
  return parts.join(' · ');
};

const SkillListRow = ({ skill }: { readonly skill: ProgramSkillRow }) => (
  <li>
    <Link
      to="/program/skills/$slug"
      params={{ slug: skill.slug }}
      className="grid gap-1 px-4 py-4 transition-colors hover:bg-sunken md:px-5"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-ui font-medium text-ink">{skill.name}</span>
        <CatalogStatusPill status={skill.status} />
      </span>
      <span className="text-meta text-ink-3">
        {domainLabel(skill.domain)} · {versionLine(skill)}
      </span>
      <span className="text-meta text-ink-3">{valueSummary(skill.values)}</span>
    </Link>
  </li>
);

const NewSkillDialog = ({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [domain, setDomain] = useState<SkillDomain>(SKILL_DOMAINS[0]);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation('program', 'createSkill', {
    invalidates: ['program'],
    onSuccess: (skill) => {
      onClose();
      void navigate({ to: '/program/skills/$slug', params: { slug: skill.slug } });
    },
    onError: (e) => setError(describeError(e)),
  });
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="New skill"
      description="It starts as a draft. Observers see it only once you publish it."
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate({ payload: { name, summary, domain, outcome, tags: [] } });
        }}
      >
        <Field>
          <Label htmlFor="new-skill-name">Name</Label>
          <Input
            id="new-skill-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor="new-skill-summary">Summary</Label>
          <Textarea
            id="new-skill-summary"
            value={summary}
            maxLength={600}
            onChange={(e) => setSummary(e.target.value)}
            className="min-h-20"
          />
          <FieldHint>One sentence on what someone who has this skill does.</FieldHint>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label htmlFor="new-skill-domain">Area</Label>
            <NativeSelect
              id="new-skill-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value as SkillDomain)}
            >
              {SKILL_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {domainLabel(d)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <Label htmlFor="new-skill-outcome">Serves</Label>
            <Input
              id="new-skill-outcome"
              value={outcome}
              maxLength={120}
              placeholder="Client trust"
              onChange={(e) => setOutcome(e.target.value)}
            />
          </Field>
        </div>
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

/** Program · Skills: every skill in any state, with its version and own values. */
export const ProgramSkillsScreen = ({ list }: { readonly list: ProgramSkillList }) => {
  const [creating, setCreating] = useState(false);
  const groups = [
    { title: 'Published', skills: list.skills.filter((s) => s.status === 'published') },
    { title: 'Drafts', skills: list.skills.filter((s) => s.status === 'draft') },
    {
      title: 'Retired and discarded',
      skills: list.skills.filter((s) => s.status === 'retired' || s.status === 'discarded'),
    },
  ].filter((g) => g.skills.length > 0);
  return (
    <Page>
      <PageHeader
        eyebrow="Program"
        title="Skills"
        description="Draft, publish and retire the skills observers rate. A published version never changes: publishing a draft makes the next version, and observations keep the version they started with."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon /> New skill
          </Button>
        }
      />
      {groups.length === 0 ? <EmptyState>No skills yet.</EmptyState> : null}
      <div className="grid gap-8">
        {groups.map((g) => (
          <section key={g.title} className="grid gap-2" aria-label={g.title}>
            <SectionLabel>
              {g.title} · {g.skills.length}
            </SectionLabel>
            <Card>
              <ul className="divide-y divide-line">
                {g.skills.map((s) => (
                  <SkillListRow key={s.id} skill={s} />
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
      <NewSkillDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
};

interface EditorIndicator {
  readonly key: string;
  readonly lineageKey: string | null;
  readonly text: string;
}
interface EditorLevel {
  readonly level: Level;
  readonly summary: string;
  readonly indicators: ReadonlyArray<EditorIndicator>;
}

let localKey = 0;
const nextKey = () => `i${++localKey}`;

/** The editor starts from the unpublished draft, else the published version, else four empty levels. */
const initialLevels = (skill: ProgramSkillDetail): Array<EditorLevel> => {
  const source = skill.draft ?? skill.published;
  return LEVELS.map((level) => {
    const found = source.find((l) => l.level === level);
    return {
      level,
      summary: found?.summary ?? '',
      indicators: (found?.indicators ?? []).map((i) => ({
        key: nextKey(),
        lineageKey: i.lineageKey,
        text: i.text,
      })),
    };
  });
};

const toInput = (levels: ReadonlyArray<EditorLevel>): Array<LevelDraftInput> =>
  levels.map((l) => ({
    level: l.level,
    summary: l.summary,
    indicators: l.indicators.map((i) => ({ lineageKey: i.lineageKey, text: i.text })),
  }));

/** Comparable content of a definition, ignoring local keys and indicator ids. */
const contentOf = (
  levels: ReadonlyArray<{
    readonly level: number;
    readonly summary: string;
    readonly indicators: ReadonlyArray<{
      readonly lineageKey: string | null;
      readonly text: string;
    }>;
  }>,
) =>
  JSON.stringify(
    levels.map((l) => ({
      level: l.level,
      summary: l.summary.trim(),
      indicators: l.indicators.map((i) => [i.lineageKey, i.text.trim()]),
    })),
  );

const LevelEditor = ({
  level,
  onChange,
}: {
  readonly level: EditorLevel;
  readonly onChange: (level: EditorLevel) => void;
}) => {
  const id = `level-${level.level}`;
  return (
    <section className="grid gap-3 px-5 py-5" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-ui font-medium text-ink">
        {level.level} · {levelName(level.level)}
      </h3>
      <Field>
        <Label htmlFor={`${id}-summary`}>What it looks like</Label>
        <Textarea
          id={`${id}-summary`}
          value={level.summary}
          maxLength={400}
          onChange={(e) => onChange({ ...level, summary: e.target.value })}
          className="min-h-16"
        />
      </Field>
      <div className="grid gap-2">
        <span className="text-ui font-medium text-ink">What an observer can see</span>
        {level.indicators.length === 0 ? (
          <FieldHint>Add at least one observable behavior before publishing.</FieldHint>
        ) : null}
        <ul className="grid gap-2">
          {level.indicators.map((indicator, index) => (
            <li key={indicator.key} className="flex items-center gap-2">
              <Input
                aria-label={`Level ${level.level} indicator ${index + 1}`}
                value={indicator.text}
                maxLength={240}
                onChange={(e) =>
                  onChange({
                    ...level,
                    indicators: level.indicators.map((i) =>
                      i.key === indicator.key ? { ...i, text: e.target.value } : i,
                    ),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove level ${level.level} indicator ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...level,
                    indicators: level.indicators.filter((i) => i.key !== indicator.key),
                  })
                }
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() =>
            onChange({
              ...level,
              indicators: [...level.indicators, { key: nextKey(), lineageKey: null, text: '' }],
            })
          }
        >
          <PlusIcon /> Add a behavior
        </Button>
      </div>
    </section>
  );
};

/** The levels as an observer meets them on the sign screen: the ladder, then what to tick. */
const ObserverPreview = ({
  name,
  levels,
}: {
  readonly name: string;
  readonly levels: ReadonlyArray<EditorLevel>;
}) => {
  const desktop = useIsDesktop();
  const [chosen, setChosen] = useState<Level | null>(3);
  const [ticked, setTicked] = useState<ReadonlyArray<string>>([]);
  const level = levels.find((l) => l.level === chosen);
  return (
    <section className="grid gap-3" aria-labelledby="preview">
      <div className="grid gap-1">
        <SectionLabel id="preview">How observers will see it</SectionLabel>
        <p className="text-ui text-ink-2">
          The ladder and behaviors exactly as an observer rates {name}. Nothing here is saved.
        </p>
      </div>
      <Card className="grid gap-4 p-4 md:p-5">
        <LevelPicker
          name={`Preview: level observed for ${name}`}
          value={chosen}
          layout={desktop ? 'row' : 'list'}
          onChange={setChosen}
          descriptions={LEVELS.map((l) => levels.find((x) => x.level === l)?.summary ?? '')}
        />
        {level && level.indicators.length > 0 ? (
          <div className="grid gap-1">
            <span className="text-meta text-ink-3">What you saw at this level · optional</span>
            {level.indicators.map((i) => (
              <IndicatorRow
                key={i.key}
                id={`preview-${i.key}`}
                text={i.text || 'An empty behavior'}
                checked={ticked.includes(i.key)}
                onCheckedChange={(on) =>
                  setTicked((t) => (on ? [...t, i.key] : t.filter((k) => k !== i.key)))
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-meta text-ink-3">This level has no behaviors yet.</p>
        )}
      </Card>
    </section>
  );
};

const ValuesForm = ({ skill }: { readonly skill: ProgramSkillDetail }) => {
  const initial = () =>
    Object.fromEntries(
      VALUE_FIELDS.map((f) => [
        f.key,
        skill.values[f.key] === null ? '' : String(skill.values[f.key]),
      ]),
    ) as Record<keyof SkillValuesView, string>;
  const [values, setValues] = useState(initial);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation('program', 'setSkillValues', {
    invalidates: ['program', 'catalog'],
    onSuccess: () => {
      toast.success(`Values for ${skill.name} saved.`);
      setReason('');
    },
    onError: (e) => setError(describeError(e)),
  });
  const parsed = Object.fromEntries(
    VALUE_FIELDS.map((f) => [f.key, parseWhole(values[f.key])]),
  ) as unknown as SkillValuesView;
  const changed = VALUE_FIELDS.some((f) => parsed[f.key] !== skill.values[f.key]);
  return (
    <section className="grid gap-3" aria-labelledby="values">
      <div className="grid gap-1">
        <SectionLabel id="values">This skill’s own values</SectionLabel>
        <p className="text-ui text-ink-2">
          Leave a value empty to use the credit rules’ value. A change applies to observations
          signed from now on; credit already signed keeps its points.
        </p>
      </div>
      <Card className="px-5">
        <form
          className="grid gap-4 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate({
              params: { slug: skill.slug },
              payload: { version: skill.version, values: parsed, reason: reason.trim() },
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {VALUE_FIELDS.map((f) => (
              <Field key={f.key}>
                <Label htmlFor={`value-${f.key}`}>{f.label}</Label>
                <Input
                  id={`value-${f.key}`}
                  inputMode="numeric"
                  value={values[f.key]}
                  placeholder={
                    skill.tenantValues
                      ? `${skill.tenantValues[f.key]} (credit rules)`
                      : 'Credit rules'
                  }
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  aria-describedby={`value-${f.key}-hint`}
                  className="tabular"
                />
                <FieldHint id={`value-${f.key}-hint`}>{f.hint}</FieldHint>
              </Field>
            ))}
          </div>
          <Field>
            <Label htmlFor="values-reason">Why are you changing them?</Label>
            <Textarea
              id="values-reason"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby="values-reason-hint"
              className="min-h-16"
            />
            <FieldHint id="values-reason-hint">
              At least 10 characters. Kept with the change in the record.
            </FieldHint>
          </Field>
          {error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="secondary"
            className="w-fit"
            disabled={!changed || reason.trim().length < 10 || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save values'}
          </Button>
        </form>
      </Card>
    </section>
  );
};

const transitionCopy = (skill: ProgramSkillDetail, event: CatalogItemEventType): TransitionCopy => {
  const next = (skill.versions[0]?.number ?? 0) + 1;
  switch (event) {
    case 'PUBLISH':
      return {
        title: next === 1 ? `Publish ${skill.name}` : `Publish version ${next} of ${skill.name}`,
        description:
          next === 1
            ? 'Publishing makes it available for plans, activities and observations.'
            : `Observers rate ${skill.name} against version ${next} from now on.`,
        consequences: [
          'The published version can never be edited; later changes become the next version.',
          ...(next > 1
            ? [
                'Observations already requested or signed keep the version they started with.',
                'Behaviors you kept carry their history; reworded ones keep it too.',
              ]
            : []),
        ],
        confirm: 'Publish',
        note: 'What changed in this version',
      };
    case 'RETIRE':
      return {
        title: `Retire ${skill.name}`,
        description: 'This cannot be undone.',
        consequences: [
          'It can no longer be chosen for new plans, activities or observations.',
          'Everything already recorded stays, including signed observations and badges.',
          'Templates that list it must drop it before they can be saved again.',
        ],
        confirm: 'Retire skill',
        note: 'Why it is retired',
      };
    case 'DISCARD':
      return {
        title: `Discard the draft of ${skill.name}`,
        description: 'It was never published. It stays in the record but can never be published.',
        consequences: [],
        confirm: 'Discard draft',
        note: 'Why it is discarded',
      };
  }
};

/** Program · one skill: details, the draft levels, a preview, its own values and its versions. */
type Details = {
  readonly name: string;
  readonly summary: string;
  readonly domain: SkillDomain;
  readonly outcome: string;
  readonly tags: string;
};

const detailsOf = (skill: ProgramSkillDetail): Details => ({
  name: skill.name,
  summary: skill.summary,
  domain: skill.domain,
  outcome: skill.outcome,
  tags: skill.tags.join(', '),
});

/** What the details-and-levels editor edits, as the server holds it. */
const editedContent = (skill: ProgramSkillDetail) =>
  JSON.stringify([detailsOf(skill), contentOf(initialLevels(skill))]);

/**
 * The details-and-levels editor's state. It starts again only when the server
 * returns different details or levels (its own save, a publish); saving the
 * skill's values bumps the version but leaves unsaved edits here alone.
 */
const useSkillEditor = (skill: ProgramSkillDetail) => {
  const [details, setDetails] = useState(() => detailsOf(skill));
  const [levels, setLevels] = useState(() => initialLevels(skill));
  const [loaded, setLoaded] = useState(() => editedContent(skill));
  if (loaded !== editedContent(skill)) {
    setLoaded(editedContent(skill));
    setDetails(detailsOf(skill));
    setLevels(initialLevels(skill));
  }
  const dirty =
    contentOf(levels) !== contentOf(initialLevels(skill)) ||
    JSON.stringify(details) !== JSON.stringify(detailsOf(skill));
  const reset = () => {
    setDetails(detailsOf(skill));
    setLevels(initialLevels(skill));
  };
  return { details, setDetails, levels, setLevels, dirty, reset };
};
type SkillEditor = ReturnType<typeof useSkillEditor>;

const DetailsCard = ({
  details,
  onChange,
  published,
}: {
  readonly details: Details;
  readonly onChange: (change: Partial<Details>) => void;
  readonly published: boolean;
}) => (
  <section className="grid gap-3" aria-labelledby="details">
    <SectionLabel id="details">Details</SectionLabel>
    <Card className="grid gap-4 p-5">
      <Field>
        <Label htmlFor="skill-name">Name</Label>
        <Input
          id="skill-name"
          value={details.name}
          maxLength={120}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {published ? (
          <FieldHint>Renaming changes how the skill reads everywhere, including history.</FieldHint>
        ) : null}
      </Field>
      <Field>
        <Label htmlFor="skill-summary">Summary</Label>
        <Textarea
          id="skill-summary"
          value={details.summary}
          maxLength={600}
          onChange={(e) => onChange({ summary: e.target.value })}
          className="min-h-16"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="skill-domain">Area</Label>
          <NativeSelect
            id="skill-domain"
            value={details.domain}
            onChange={(e) => onChange({ domain: e.target.value as SkillDomain })}
          >
            {SKILL_DOMAINS.map((d) => (
              <option key={d} value={d}>
                {domainLabel(d)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <Label htmlFor="skill-outcome">Serves</Label>
          <Input
            id="skill-outcome"
            value={details.outcome}
            maxLength={120}
            onChange={(e) => onChange({ outcome: e.target.value })}
          />
        </Field>
      </div>
      <Field>
        <Label htmlFor="skill-tags">Tags</Label>
        <Input
          id="skill-tags"
          value={details.tags}
          onChange={(e) => onChange({ tags: e.target.value })}
        />
        <FieldHint>Separate with commas. Used to find the skill.</FieldHint>
      </Field>
    </Card>
  </section>
);

const nextVersion = (skill: ProgramSkillDetail) => (skill.versions[0]?.number ?? 0) + 1;

/** Details and draft levels; saving keeps observers on the published version until it is published. */
const SkillEditorForm = ({
  skill,
  editor,
}: {
  readonly skill: ProgramSkillDetail;
  readonly editor: SkillEditor;
}) => {
  const [error, setError] = useState<string | null>(null);
  const update = useApiMutation('program', 'updateSkill', {
    invalidates: ['program', 'catalog'],
    onSuccess: () => toast.success('Saved.'),
    onError: (e) => setError(describeError(e)),
  });
  const { details, levels, dirty } = editor;
  const published = skill.currentVersion !== null;
  const save = (definition: Array<LevelDraftInput> | null) => {
    setError(null);
    update.mutate({
      params: { slug: skill.slug },
      payload: {
        version: skill.version,
        ...details,
        tags: details.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        definition,
      },
    });
  };
  const matchesPublished =
    skill.published.length > 0 && contentOf(levels) === contentOf(skill.published);
  let saveLabel = published ? 'Save changes' : 'Save draft';
  if (update.isPending) saveLabel = 'Saving…';
  return (
    <form
      className="grid gap-10"
      onSubmit={(e) => {
        e.preventDefault();
        save(skill.draft === null && matchesPublished ? null : toInput(levels));
      }}
    >
      <DetailsCard
        details={details}
        published={published}
        onChange={(change) => editor.setDetails((d) => ({ ...d, ...change }))}
      />
      <section className="grid gap-3" aria-labelledby="levels">
        <div className="grid gap-1">
          <SectionLabel id="levels">
            {published ? `Levels · changes become version ${nextVersion(skill)}` : 'Levels'}
          </SectionLabel>
          <p className="text-ui text-ink-2">
            Each level needs a summary and at least one behavior an observer can actually see.
            {published
              ? ' Observers keep the published version until you publish these changes.'
              : ''}
          </p>
        </div>
        <Card className="divide-y divide-line">
          {levels.map((l) => (
            <LevelEditor
              key={l.level}
              level={l}
              onChange={(next) =>
                editor.setLevels((all) => all.map((x) => (x.level === next.level ? next : x)))
              }
            />
          ))}
        </Card>
      </section>
      <div className="grid gap-2">
        {error ? (
          <p role="alert" className="text-ui text-danger-ink">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={!dirty || update.isPending}>
            {saveLabel}
          </Button>
          {dirty ? (
            <Button type="button" variant="ghost" onClick={editor.reset}>
              Undo my changes
            </Button>
          ) : null}
          {!dirty && skill.draft !== null && published ? (
            <Button type="button" variant="ghost" onClick={() => save(null)}>
              Drop unpublished changes
            </Button>
          ) : null}
        </div>
        {!skill.draftComplete && skill.draft !== null ? (
          <FieldHint>It can be published once every level has a summary and a behavior.</FieldHint>
        ) : null}
      </div>
    </form>
  );
};

const PublishedLevels = ({ skill }: { readonly skill: ProgramSkillDetail }) => (
  <section className="grid gap-3" aria-labelledby="levels">
    <SectionLabel id="levels">Levels</SectionLabel>
    <Card className="divide-y divide-line">
      {skill.published.map((l) => (
        <div key={l.level} className="grid gap-2 px-5 py-4">
          <h3 className="text-ui font-medium text-ink">
            {l.level} · {levelName(l.level)}
          </h3>
          <p className="text-ui text-ink-2">{l.summary}</p>
          <ul className="grid list-disc gap-1 pl-5 text-ui text-ink-2">
            {l.indicators.map((i) => (
              <li key={i.id}>{i.text}</li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  </section>
);

const Versions = ({ skill }: { readonly skill: ProgramSkillDetail }) => (
  <section className="grid gap-3" aria-labelledby="versions">
    <SectionLabel id="versions">Versions</SectionLabel>
    {skill.versions.length === 0 ? (
      <p className="text-ui text-ink-3">Not published yet.</p>
    ) : (
      <ol className="grid gap-3">
        {skill.versions.map((v) => (
          <li key={v.number} className="grid gap-0.5">
            <span className="flex items-center gap-2 text-ui text-ink">
              Version {v.number}
              {v.number === skill.currentVersion ? <Pill tone="success">Current</Pill> : null}
            </span>
            <span className="text-meta text-ink-3">
              {formatDate(v.publishedAt, { year: 'numeric' })}
              {v.publishedBy ? ` · ${v.publishedBy.displayName}` : ''}
            </span>
            {v.changeNote ? <span className="text-meta text-ink-2">{v.changeNote}</span> : null}
          </li>
        ))}
      </ol>
    )}
  </section>
);

const UsedByTemplates = ({ skill }: { readonly skill: ProgramSkillDetail }) => (
  <section className="grid gap-3" aria-labelledby="templates">
    <SectionLabel id="templates">Activity templates that list it</SectionLabel>
    {skill.templates.length === 0 ? (
      <p className="text-ui text-ink-3">None.</p>
    ) : (
      <ul className="grid gap-2">
        {skill.templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2">
            <Link
              to="/program/templates/$id"
              params={{ id: t.id }}
              className="text-ui text-primary-ink hover:underline"
            >
              {t.name}
            </Link>
            <CatalogStatusPill status={t.status} />
          </li>
        ))}
      </ul>
    )}
  </section>
);

/** Program · one skill: details, the draft levels, a preview, its own values and its versions. */
export const ProgramSkillScreen = ({ skill }: { readonly skill: ProgramSkillDetail }) => {
  const editor = useSkillEditor(skill);
  const transition = useApiMutation('program', 'skillTransition', {
    invalidates: ['program', 'catalog'],
    onSuccess: (s) => toast.success(`${s.name} is ${s.status}.`),
    onError: () => undefined,
  });
  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link to="/program/skills" className="hover:text-ink">
            Program · Skills
          </Link>
        }
        title={skill.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CatalogStatusPill status={skill.status} />
            <span className="text-ui text-ink-3">{versionLine(skill)}</span>
          </span>
        }
        actions={
          <CatalogActions
            actions={skill.actions}
            copyFor={(event) => transitionCopy(skill, event)}
            unsaved={editor.dirty}
            submit={(event, note) =>
              transition.mutateAsync({
                params: { slug: skill.slug },
                payload: { version: skill.version, event, note },
              })
            }
          />
        }
      />
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-12">
          {skill.canEdit ? (
            <SkillEditorForm skill={skill} editor={editor} />
          ) : (
            <PublishedLevels skill={skill} />
          )}
          <ObserverPreview name={editor.details.name || skill.name} levels={editor.levels} />
        </div>
        <aside className="grid content-start gap-10">
          {/* Restarts only when the values change, so saving details keeps a typed value. */}
          {skill.canEdit ? <ValuesForm key={JSON.stringify(skill.values)} skill={skill} /> : null}
          <Versions skill={skill} />
          <UsedByTemplates skill={skill} />
          <ChangeHistory history={skill.history} empty="No changes recorded yet." />
        </aside>
      </div>
    </Page>
  );
};
