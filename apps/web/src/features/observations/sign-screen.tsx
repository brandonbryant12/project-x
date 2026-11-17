import type { ObservationView } from '@repo/api';
import {
  OBSERVATION_MODE_LABELS,
  OBSERVATION_MODES,
  type ObservationMode,
  type SkillId,
} from '@repo/domain';
import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DueLabel,
  PersonAvatar,
  StatusPill,
  toast,
  SegmentedControl,
  SegmentedItem,
} from '@repo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon, ChevronDownIcon, EllipsisIcon } from 'lucide-react';
import { useState } from 'react';
import { call, queryOptions, useApiMutation } from '@/lib/api.ts';
import { formatDate, levelName } from '@/lib/format.ts';
import { OBSERVATION_STATUS } from '@/lib/lifecycle-presentation.ts';
import { useIsDesktop } from '@/lib/use-media.ts';
import { NOTE_EVENTS, NoteEventDialog, type NoteEvent } from './event-dialog.tsx';
import { AddSkill, EvidenceCard, NarrativeEditor, PreReadPanel, RatingEditor } from './parts.tsx';
import { ReadView } from './read-view.tsx';
import { ReviewAndSignDialog } from './review-dialog.tsx';
import {
  describeSave,
  missingToSign,
  toPayload,
  useObservationDraft,
  type Draft,
  type DraftRating,
} from './use-observation-draft.ts';

const EDITABLE = new Set(['requested', 'drafting']);

const EarlierObservations = ({ view }: { readonly view: ObservationView }) =>
  view.earlier.length === 0 ? null : (
    <Collapsible className="rounded-card border border-line">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between px-4 py-3 text-ui font-medium text-ink-2">
        Earlier observations of these skills
        <ChevronDownIcon className="size-4 text-ink-3 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="grid gap-2 border-t border-line px-4 py-3">
          {view.earlier.map((e) => (
            <li key={`${e.id}-${e.skill.id}`} className="flex items-center gap-2.5 text-ui">
              <PersonAvatar person={e.observer} size="xs" />
              <span className="flex-1 text-ink-2">
                {e.skill.name} · {levelName(e.level)}
              </span>
              <span className="text-meta text-ink-3 tabular">{formatDate(e.occurredOn)}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );

const EditorHeader = ({
  view,
  saveText,
  saveProblem,
  noteActions,
  onNoteAction,
}: {
  readonly view: ObservationView;
  readonly saveText: string;
  readonly saveProblem: boolean;
  readonly noteActions: ReadonlyArray<NoteEvent>;
  readonly onNoteAction: (event: NoteEvent) => void;
}) => {
  const first = view.subject.displayName.split(' ')[0] ?? view.subject.displayName;
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-4 py-3 md:px-6">
      <Button variant="ghost" size="icon-sm" asChild aria-label="Back to inbox">
        <Link to="/inbox">
          <ArrowLeftIcon />
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-h2 font-semibold text-ink">
          Observation for {view.subject.displayName}
        </h1>
        <p className="truncate text-meta text-ink-3">{view.interaction.activityTitle}</p>
      </div>
      <div className="order-last flex w-full items-center gap-3 pl-11 md:order-none md:w-auto md:pl-0">
        <StatusPill {...OBSERVATION_STATUS[view.status]} />
        <DueLabel dueAt={view.dueAt} />
        <span
          aria-live="polite"
          className={cn(
            'ml-auto text-meta text-ink-3 md:ml-0 md:min-w-24 md:text-right',
            saveProblem && 'text-warning-ink',
          )}
        >
          {saveText}
        </span>
      </div>
      {noteActions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {noteActions.map((a) => (
              <DropdownMenuItem key={a} onSelect={() => onNoteAction(a)}>
                {a === 'RETURN' ? `Send back to ${first}` : NOTE_EVENTS[a].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </header>
  );
};

const summaryOf = (draft: Draft) =>
  [
    `${draft.ratings.length} ${draft.ratings.length === 1 ? 'skill' : 'skills'}`,
    `${draft.ratings.reduce((n, r) => n + r.indicatorIds.length, 0)} indicators`,
    ...draft.ratings.flatMap((r) => (r.level ? [levelName(r.level)] : [])).slice(0, 1),
  ].join(' · ');

/** What happened, earlier observations and the assistant pre-read; collapsible on phones. */
const EvidencePane = ({
  view,
  desktop,
}: {
  readonly view: ObservationView;
  readonly desktop: boolean;
}) => (
  <aside className="border-line bg-sunken/70 lg:sticky lg:top-14 lg:h-[calc(100dvh-56px-64px)] lg:overflow-y-auto lg:border-r">
    <div className="grid gap-6 px-4 py-5 md:px-6 lg:py-6">
      {desktop ? (
        <EvidenceCard view={view} />
      ) : (
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between text-ui font-medium text-ink">
            What happened
            <ChevronDownIcon className="size-4 text-ink-3 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <EvidenceCard view={view} />
          </CollapsibleContent>
        </Collapsible>
      )}
      <EarlierObservations view={view} />
      <PreReadPanel advisory={view.advisory} />
    </div>
  </aside>
);

/** The observer owns the mode (I15). Wraps on narrow phones rather than scrolling sideways. */
const ModeField = ({
  mode,
  onChange,
}: {
  readonly mode: ObservationMode;
  readonly onChange: (mode: ObservationMode) => void;
}) => (
  <div className="grid gap-2">
    <span className="text-ui font-medium text-ink">How do you know?</span>
    <SegmentedControl
      type="single"
      value={mode}
      onValueChange={(next) => {
        if (next) onChange(next as ObservationMode);
      }}
      aria-label="How you observed this work"
      className="flex-wrap justify-self-start"
    >
      {OBSERVATION_MODES.map((m) => (
        <SegmentedItem key={m} value={m}>
          {OBSERVATION_MODE_LABELS[m]}
        </SegmentedItem>
      ))}
    </SegmentedControl>
    <p className="text-meta text-ink-3">
      Only what you saw or reviewed yourself counts as first-hand.
    </p>
  </div>
);

const SignBar = ({
  status,
  canReturn,
  onReturn,
  canReview,
  onReview,
}: {
  readonly status: string;
  readonly canReturn: boolean;
  readonly onReturn: () => void;
  readonly canReview: boolean;
  readonly onReview: () => void;
}) => (
  <div className="sticky bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-canvas/95 backdrop-blur lg:bottom-0">
    <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 md:px-6">
      <p className="flex-1 truncate text-ui text-ink-2">{status}</p>
      {canReturn ? (
        <Button variant="ghost" onClick={onReturn}>
          Return
        </Button>
      ) : null}
      <Button variant="primary" disabled={!canReview} onClick={onReview}>
        Review and sign
      </Button>
    </div>
  </div>
);

/** The observer's editing surface (ux-brief §2.5). */
const Editor = ({ view }: { readonly view: ObservationView }) => {
  const desktop = useIsDesktop();
  const qc = useQueryClient();
  const editable = view.viewerRole === 'observer' && EDITABLE.has(view.status);
  const { draft, update, save, suggested, version, cancelPendingSave } = useObservationDraft(
    view,
    editable,
  );
  const [reviewing, setReviewing] = useState(false);
  const [noteEvent, setNoteEvent] = useState<NoteEvent | null>(null);
  const transition = useApiMutation('observations', 'transition', {
    onSuccess: () => {
      setNoteEvent(null);
      toast.success('Done.');
    },
  });
  const skills = useQuery(queryOptions('catalog', 'skills', { query: {} }));
  const skillName = (id: string) =>
    view.ratings.find((r) => r.skill.id === id)?.skill.name ??
    skills.data?.find((s) => s.id === id)?.name ??
    'Skill';
  // A skill added in this session has no pinned ladder until the draft saves.
  const levelsOf = (id: string) => view.ratings.find((r) => r.skill.id === id)?.levels ?? [];
  const missing = missingToSign(draft);
  const first = view.subject.displayName.split(' ')[0] ?? view.subject.displayName;
  const setRating = (skillId: SkillId, next: DraftRating) =>
    update((d) => ({ ...d, ratings: d.ratings.map((r) => (r.skillId === skillId ? next : r)) }));
  const noteActions = view.actions.filter((a): a is NoteEvent => a in NOTE_EVENTS);

  const sign = async () => {
    cancelPendingSave();
    const signed = await call('observations', 'sign', {
      params: { id: view.id },
      payload: toPayload(draft, version(), suggested),
    });
    await qc.invalidateQueries();
    return signed;
  };

  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col">
      <EditorHeader
        view={view}
        saveText={describeSave(save)}
        saveProblem={save.kind === 'failed' || save.kind === 'conflict'}
        noteActions={noteActions}
        onNoteAction={setNoteEvent}
      />
      {save.kind === 'conflict' ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-line bg-warning-soft px-6 py-2.5 text-ui text-warning-ink"
        >
          This observation changed in another window. Reload to continue; your text above is still
          here to copy.
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : null}
      <div className="grid flex-1 lg:grid-cols-[42fr_58fr]">
        <EvidencePane view={view} desktop={desktop} />
        <div className="px-4 py-5 md:px-6 lg:py-6">
          <div className="mx-auto grid max-w-[640px] gap-6">
            <div className="grid gap-1">
              <h2 className="font-serif text-h1 font-medium text-ink">What you saw</h2>
              <p className="text-ui text-ink-2">
                {first} asked you to look at{' '}
                {view.requestedSkills.map((s) => s.name).join(' and ') || 'this work'}.
              </p>
            </div>
            <ModeField mode={draft.mode} onChange={(mode) => update((d) => ({ ...d, mode }))} />
            {draft.ratings.map((r) => (
              <RatingEditor
                key={r.skillId}
                skillName={skillName(r.skillId)}
                levels={levelsOf(r.skillId)}
                idPrefix={view.id}
                draft={r}
                suggested={suggested}
                compact={!desktop}
                canRemove={draft.ratings.length > 1}
                onChange={(next) => setRating(r.skillId, next)}
                onRemove={() =>
                  update((d) => ({
                    ...d,
                    ratings: d.ratings.filter((x) => x.skillId !== r.skillId),
                  }))
                }
              />
            ))}
            {draft.ratings.length < 3 ? (
              <AddSkill
                exclude={draft.ratings.map((r) => r.skillId)}
                onAdd={(skill) =>
                  update((d) => ({
                    ...d,
                    ratings: [
                      ...d.ratings,
                      { skillId: skill.id, level: null, indicatorIds: [], credit: true },
                    ],
                  }))
                }
              />
            ) : null}
            <NarrativeEditor
              saw={draft.narrativeSaw}
              next={draft.narrativeNext}
              onSaw={(v) => update((d) => ({ ...d, narrativeSaw: v }))}
              onNext={(v) => update((d) => ({ ...d, narrativeNext: v }))}
              subjectFirstName={first}
              advisory={view.advisory}
              readOnly={!editable}
            />
          </div>
        </div>
      </div>
      {editable ? (
        <SignBar
          status={missing ?? summaryOf(draft)}
          canReturn={view.actions.includes('RETURN') && desktop}
          onReturn={() => setNoteEvent('RETURN')}
          canReview={missing === null && save.kind !== 'saving' && save.kind !== 'conflict'}
          onReview={() => setReviewing(true)}
        />
      ) : null}
      <ReviewAndSignDialog
        open={reviewing}
        onOpenChange={setReviewing}
        subjectName={view.subject.displayName}
        occurredOn={view.interaction.occurredOn}
        draft={draft}
        skillName={skillName}
        onSign={sign}
      />
      <NoteEventDialog
        event={noteEvent}
        pending={transition.isPending}
        onClose={() => setNoteEvent(null)}
        onSubmit={(event, note) =>
          transition.mutate({ params: { id: view.id }, payload: { event, note: note || null } })
        }
      />
    </div>
  );
};

export const ObservationScreen = ({ view }: { readonly view: ObservationView }) =>
  view.viewerRole === 'observer' && EDITABLE.has(view.status) ? (
    <Editor view={view} />
  ) : (
    <ReadView view={view} />
  );
