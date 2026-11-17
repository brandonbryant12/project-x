import type { AdvisoryView, ObservationView, RatingView, SkillRef } from '@repo/api';
import {
  OBSERVATION_MODE_LABELS,
  type Level,
  type SkillId,
  type SkillIndicatorId,
  type SkillLevelDefinition,
} from '@repo/domain';
import {
  AssistantNote,
  AssistantPreRead,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Field,
  FieldHint,
  IndicatorRow,
  Label,
  LevelMeter,
  LevelPicker,
  PersonChip,
  Pill,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  type PreReadFinding,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { queryOptions } from '@/lib/api.ts';
import { formatLongDate, kindLabel, levelName } from '@/lib/format.ts';
import { BASIS_LABEL, basisSentence, EVIDENCE_STATUS } from '@/lib/lifecycle-presentation.ts';
import { MIN_SAW, type DraftRating } from './use-observation-draft.ts';

const relationLine = (view: ObservationView) =>
  basisSentence(
    view.basis,
    view.viewerRole,
    view.observer.displayName.split(' ')[0] ?? '',
    view.subject.displayName.split(' ')[0] ?? '',
  );

/** What happened: the account of the person observed, framed as theirs. */
export const EvidenceCard = ({
  view,
  showTitle = true,
}: {
  readonly view: ObservationView;
  readonly showTitle?: boolean;
}) => {
  const evidence = view.evidence;
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-meta text-ink-3">
          {kindLabel(view.interaction.kind)} · {formatLongDate(view.interaction.occurredOn)}
        </p>
        {showTitle ? (
          <h2 className="text-h2 font-semibold text-ink">{view.interaction.activityTitle}</h2>
        ) : null}
        <p className="text-ui text-ink-2">
          {OBSERVATION_MODE_LABELS[view.mode]} · {relationLine(view)}
        </p>
      </div>
      {view.requestNote ? (
        <figure className="rounded-card border border-line bg-surface px-4 py-3">
          <figcaption className="mb-1 text-meta text-ink-3">
            {view.requestedBy.displayName.split(' ')[0]}’s note to you
          </figcaption>
          <blockquote className="narrative text-ink">{view.requestNote}</blockquote>
        </figure>
      ) : null}
      {evidence ? (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-meta font-medium text-ink-3">
              In {view.subject.displayName.split(' ')[0]}’s words
            </p>
            {evidence.status !== 'available' ? (
              <Pill tone={EVIDENCE_STATUS[evidence.status].tone} dot>
                {EVIDENCE_STATUS[evidence.status].label}
              </Pill>
            ) : null}
          </div>
          {evidence.body ? (
            <p className="narrative whitespace-pre-line text-ink">{evidence.body}</p>
          ) : (
            <AssistantNote>
              {view.subject.displayName.split(' ')[0]}’s description is on hold for a privacy check
              and isn’t visible yet. They’ve been asked to revise it.
            </AssistantNote>
          )}
        </div>
      ) : (
        <p className="text-ui text-ink-3">
          No written account. You started this from what you saw.
        </p>
      )}
    </section>
  );
};

const PRIVACY_LABEL = {
  hold: 'Held: it may include client details',
  escalate: 'Sent to compliance',
  nudge: 'Possible client details, not held',
} as const;

/** What the privacy check found, already hedged by the server. Nothing found: nothing to show. */
const privacyFindings = (advisory: ReadonlyArray<AdvisoryView>): Array<PreReadFinding> =>
  advisory.flatMap((a) =>
    a.status === 'completed' &&
    a.questionSet === 'privacy-screen' &&
    a.effect !== null &&
    a.effect !== 'none'
      ? [{ key: a.id, label: PRIVACY_LABEL[a.effect], outcome: 'unclear' as const }]
      : [],
  );

/** The automated privacy check, shown only when it found something. */
export const PreReadPanel = ({ advisory }: { readonly advisory: ReadonlyArray<AdvisoryView> }) => {
  const findings = privacyFindings(advisory);
  if (findings.length === 0) return null;
  return <AssistantPreRead findings={findings} state="ready" />;
};

export const NarrativeEditor = ({
  saw,
  next,
  onSaw,
  onNext,
  subjectFirstName,
  readOnly,
}: {
  readonly saw: string;
  readonly next: string;
  readonly onSaw: (v: string) => void;
  readonly onNext: (v: string) => void;
  readonly subjectFirstName: string;
  readonly readOnly: boolean;
}) => (
  <section className="grid gap-5">
    <Field>
      <Label htmlFor="narrative-saw">What I saw</Label>
      <Textarea
        id="narrative-saw"
        rows={4}
        readOnly={readOnly}
        value={saw}
        onChange={(e) => onSaw(e.target.value)}
        placeholder={`What did ${subjectFirstName} do, and what did it lead to?`}
        className="narrative min-h-32"
      />
      {saw.trim().length < MIN_SAW ? (
        <FieldHint className="tabular">
          {MIN_SAW - saw.trim().length} more characters to sign
        </FieldHint>
      ) : null}
    </Field>
    <Field>
      <Label htmlFor="narrative-next">What next</Label>
      <Textarea
        id="narrative-next"
        rows={2}
        readOnly={readOnly}
        value={next}
        onChange={(e) => onNext(e.target.value)}
        placeholder="One concrete thing to try next time"
        className="narrative min-h-20"
      />
    </Field>
  </section>
);

/** One skill being rated: level first, then the optional indicators for that level. */
export const RatingEditor = ({
  skillName,
  levels,
  idPrefix,
  draft,
  onChange,
  onRemove,
  canRemove,
  compact,
  collapseIndicators = false,
}: {
  readonly skillName: string;
  /** The pinned skill version's ladder; empty while it loads. */
  readonly levels: ReadonlyArray<SkillLevelDefinition>;
  readonly idPrefix: string;
  readonly draft: DraftRating;
  readonly onChange: (next: DraftRating) => void;
  readonly onRemove: () => void;
  readonly canRemove: boolean;
  readonly compact: boolean;
  /** Quick capture keeps the optional indicators one tap away. */
  readonly collapseIndicators?: boolean;
}) => {
  const current = levels.find((l) => l.level === draft.level);
  const toggle = (id: SkillIndicatorId, on: boolean) =>
    onChange({
      ...draft,
      indicatorIds: on ? [...draft.indicatorIds, id] : draft.indicatorIds.filter((x) => x !== id),
    });
  const indicators =
    current && current.indicators.length > 0
      ? current.indicators.map((indicator) => (
          <IndicatorRow
            key={indicator.id}
            id={`${idPrefix}-${indicator.id}`}
            text={indicator.text}
            checked={draft.indicatorIds.includes(indicator.id)}
            onCheckedChange={(on) => toggle(indicator.id, on)}
          />
        ))
      : null;
  return (
    <section className="grid gap-4 rounded-card border border-line bg-surface p-4 md:p-5">
      <header className="flex items-start gap-3">
        <LevelMeter level={draft.level} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-h2 font-semibold text-ink">{skillName}</h3>
          <p className="text-meta text-ink-3">
            {draft.level ? levelName(draft.level) : 'Choose the level you saw'}
          </p>
        </div>
        {canRemove ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${skillName}`}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </header>
      <LevelPicker
        name={`Level observed for ${skillName}`}
        value={draft.level}
        layout={compact ? 'list' : 'row'}
        onChange={(level: Level) => onChange({ ...draft, level })}
        descriptions={[1, 2, 3, 4].map((l) => levels.find((x) => x.level === l)?.summary ?? '')}
      />
      {indicators && collapseIndicators ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 text-left text-meta text-ink-3">
            <span>
              What you saw at this level · optional
              {draft.indicatorIds.length > 0 ? ` · ${draft.indicatorIds.length} ticked` : ''}
            </span>
            <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-1">{indicators}</CollapsibleContent>
        </Collapsible>
      ) : null}
      {indicators && !collapseIndicators ? (
        <div className="grid gap-1">
          <p className="text-meta text-ink-3">What you saw at this level · optional</p>
          {indicators}
        </div>
      ) : null}
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-ui text-ink-2 md:min-h-0">
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-(--color-primary)"
          checked={!draft.credit}
          onChange={(e) => onChange({ ...draft, credit: !e.target.checked })}
        />
        Feedback only, not yet. Nothing is credited for this skill.
      </label>
    </section>
  );
};

/** Add one more skill from the catalog (an observation rates up to three). */
export const AddSkill = ({
  exclude,
  onAdd,
}: {
  readonly exclude: ReadonlyArray<SkillId>;
  readonly onAdd: (skill: SkillRef) => void;
}) => {
  const [open, setOpen] = useState(false);
  const skills = useQuery({ ...queryOptions('catalog', 'skills', { query: {} }), enabled: open });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="justify-self-start">
          <PlusIcon /> Add a skill
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder="Find a skill" />
          <CommandList>
            <CommandEmpty>No skills match.</CommandEmpty>
            {(skills.data ?? [])
              .filter((s) => !exclude.includes(s.id))
              .map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.name}
                  onSelect={() => {
                    onAdd({ id: s.id, slug: s.slug, name: s.name, domain: s.domain });
                    setOpen(false);
                  }}
                >
                  {s.name}
                </CommandItem>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/** A signed or read-only rating. */
export const RatingRead = ({ rating }: { readonly rating: RatingView }) => {
  const ticked = rating.levels
    .flatMap((l) => l.indicators)
    .filter((i) => rating.indicatorIds.includes(i.id));
  return (
    <div className="flex items-start gap-3">
      <LevelMeter level={rating.level} className="mt-1 h-5 w-9 justify-center" />
      <div className="grid gap-1">
        <p className="text-ui font-medium text-ink">{rating.skill.name}</p>
        <p className="text-meta text-ink-3">
          {rating.level ? levelName(rating.level) : 'No level'}
          {rating.credit ? '' : ' · feedback only'}
        </p>
        {ticked.length > 0 ? (
          <ul className="mt-1 grid gap-1">
            {ticked.map((i) => (
              <li key={i.id} className="text-ui text-ink-2">
                {i.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
};

export const PeopleLine = ({ view }: { readonly view: ObservationView }) => (
  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
    <PersonChip person={view.subject} subtitle="Observed" />
    <PersonChip person={view.observer} subtitle={BASIS_LABEL[view.basis]} />
  </div>
);
