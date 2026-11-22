import type { InboxView, ObservationView, ObserveTarget, SkillDetail, SkillRef } from '@repo/api';
import {
  INTERACTION_KINDS,
  MAX_SKILLS_PER_OBSERVATION,
  MIN_NARRATIVE_LENGTH,
  OBSERVATION_MODES,
  OBSERVE_WINDOW_DAYS,
  type InteractionKind,
  type ObservationMode,
} from '@repo/domain';
import {
  AssistantNote,
  BadgeSeal,
  Button,
  Card,
  cn,
  EmptyState,
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  PersonAvatar,
  Pill,
  Textarea,
  toast,
} from '@repo/ui';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Effect } from 'effect';
import { CheckCircle2Icon, CheckIcon, MessageSquarePlusIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Page, PageHeader } from '@/components/page.tsx';
import { VoiceNoteBar } from '@/components/voice-note-bar.tsx';
import { callEffect, describeError, queryOptions } from '@/lib/api.ts';
import { useMachine } from '@/lib/foldkit.ts';
import { daysAgoIso, formatDate, formatLongDate, kindLabel, todayIso } from '@/lib/format.ts';
import { BASIS_LABEL } from '@/lib/lifecycle-presentation.ts';
import { useIsDesktop } from '@/lib/use-media.ts';
import {
  canSaveDraft,
  createGiveFeedbackMachine,
  isOutsideWindow,
  missingToPublish,
  occurredOnOf,
  privacyOf,
  type GiveFeedbackContext,
  type GiveFeedbackEvent,
  type When,
} from './give-feedback-machine.ts';
import { AddSkill, RatingEditor } from './parts.tsx';

const MODE_LABELS: Record<ObservationMode, string> = {
  saw_it: 'I saw it live',
  reviewed_work: 'I reviewed a recording / work',
  discussed: 'We debriefed it',
};

const WHEN: ReadonlyArray<readonly [When, string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['earlier', 'Earlier'],
];

const Chip = ({
  on,
  onClick,
  children,
}: {
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={cn(
      'inline-flex min-h-10 max-w-full cursor-pointer items-center gap-2 rounded-full border px-3.5 text-left text-ui transition-colors md:min-h-9',
      on
        ? 'border-primary bg-primary-soft font-medium text-primary-ink'
        : 'border-line bg-surface text-ink-2 hover:bg-sunken',
    )}
  >
    {children}
  </button>
);

const StepSection = ({
  step,
  label,
  children,
}: {
  readonly step: string;
  readonly label: string;
  readonly children: React.ReactNode;
}) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex items-center gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-ink tabular">
          {step}
        </span>
        <h2 id={id} className="text-ui font-semibold text-ink">
          {label}
        </h2>
      </div>
      {children}
    </section>
  );
};

const OpenRequestBanner = ({
  inbox,
  target,
}: {
  readonly inbox: InboxView | undefined;
  readonly target: ObserveTarget;
}) => {
  const first = target.person.displayName.split(' ')[0] ?? '';
  const request = inbox?.requests.find((r) => r.subject.id === target.person.id);
  if (request) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary-soft/40 px-4 py-3 text-ui">
        <span className="text-ink">
          {first} already requested feedback on{' '}
          <span className="font-medium">{request.activityTitle}</span> (
          {formatDate(request.occurredOn)}).
        </span>
        <Button size="sm" variant="primary" asChild>
          <Link to="/observations/$id" params={{ id: request.id }}>
            Respond to request
          </Link>
        </Button>
      </Card>
    );
  }
  const draft = inbox?.drafts.find((r) => r.subject.id === target.person.id);
  if (!draft) return null;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-line bg-sunken px-4 py-3 text-ui">
      <span className="text-ink-2">
        You have an unfinished draft for {first} from {formatDate(draft.occurredOn)}.
      </span>
      <Button size="sm" variant="secondary" asChild>
        <Link to="/observations/$id" params={{ id: draft.id }}>
          Continue draft
        </Link>
      </Button>
    </Card>
  );
};

const PeoplePicker = ({
  targets,
  selectedId,
  onSelect,
}: {
  readonly targets: ReadonlyArray<ObserveTarget>;
  readonly selectedId: string | null;
  readonly onSelect: (t: ObserveTarget) => void;
}) => {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll || targets.length <= 8 ? targets : targets.slice(0, 6);
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {visible.map((t) => {
        const active = t.person.id === selectedId;
        return (
          <button
            key={t.person.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(t)}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-card border p-3.5 text-left transition-colors',
              active
                ? 'border-primary bg-primary-soft/45 ring-1 ring-primary/30'
                : 'border-line bg-surface hover:border-line-strong',
            )}
          >
            <PersonAvatar person={t.person} size="sm" />
            <span className="grid min-w-0 flex-1 gap-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-ui font-semibold text-ink">
                  {t.person.displayName}
                </span>
                {active ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
              </span>
              <span className="text-meta text-ink-3">
                {BASIS_LABEL[t.basis]}
                {t.focusSkills.length > 0
                  ? ` · Focusing on ${t.focusSkills.map((s) => s.name).join(', ')}`
                  : ''}
              </span>
            </span>
          </button>
        );
      })}
      {visible.length < targets.length ? (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => setShowAll(true)}
        >
          Show everyone ({targets.length})
        </Button>
      ) : null}
    </div>
  );
};

const ContextSection = ({
  ctx,
  send,
}: {
  readonly ctx: GiveFeedbackContext;
  readonly send: (e: GiveFeedbackEvent) => void;
}) => {
  const occurredOn = occurredOnOf(ctx);
  const outside = isOutsideWindow(occurredOn);
  return (
    <StepSection step="2" label="About the meeting or work">
      <div className="grid gap-3 rounded-card border border-line bg-surface p-4">
        <div className="grid gap-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <NativeSelect
            aria-label="Kind of work"
            value={ctx.kind}
            onChange={(e) => send({ type: 'SET_KIND', kind: e.target.value as InteractionKind })}
          >
            {INTERACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </NativeSelect>
          <Input
            aria-label="Short title (optional)"
            placeholder="Optional label, e.g. Retirement discovery call"
            value={ctx.title}
            maxLength={120}
            onChange={(e) => send({ type: 'SET_TITLE', title: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {WHEN.map(([value, label]) => (
            <Chip
              key={value}
              on={ctx.when === value}
              onClick={() => send({ type: 'SET_WHEN', when: value })}
            >
              {label}
            </Chip>
          ))}
          {ctx.when === 'earlier' ? (
            <Input
              type="date"
              aria-label="Date of work"
              min={daysAgoIso(OBSERVE_WINDOW_DAYS)}
              max={todayIso()}
              value={ctx.earlier}
              onChange={(e) => send({ type: 'SET_EARLIER', date: e.target.value })}
              className="w-auto"
            />
          ) : (
            <span className="text-meta text-ink-3">{formatLongDate(occurredOn)}</span>
          )}
        </div>
        {outside ? (
          <FieldHint className="text-warning-ink">
            Pick a date within the last {OBSERVE_WINDOW_DAYS} days.
          </FieldHint>
        ) : null}
        <div className="grid gap-1.5 border-t border-line pt-3">
          <span className="text-meta font-medium text-ink-2">How did you observe it?</span>
          <div className="flex flex-wrap gap-2">
            {OBSERVATION_MODES.map((m) => (
              <Chip key={m} on={ctx.mode === m} onClick={() => send({ type: 'SET_MODE', mode: m })}>
                {MODE_LABELS[m]}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </StepSection>
  );
};

const SkillsAndNotes = ({
  ctx,
  send,
  suggestions,
  levelsOf,
  nameOf,
  desktop,
}: {
  readonly ctx: GiveFeedbackContext;
  readonly send: (e: GiveFeedbackEvent) => void;
  readonly suggestions: ReadonlyArray<SkillRef>;
  readonly levelsOf: (id: string) => SkillDetail['levels'];
  readonly nameOf: (id: string) => string;
  readonly desktop: boolean;
}) => {
  const first = ctx.target?.person.displayName.split(' ')[0] ?? 'them';
  const privacy = privacyOf(ctx);
  const short = MIN_NARRATIVE_LENGTH - ctx.narrativeSaw.trim().length;
  return (
    <>
      <StepSection step="3" label="Skills & level you observed">
        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Chip
                key={s.id}
                on={ctx.ratings.some((r) => r.skillId === s.id)}
                onClick={() => send({ type: 'TOGGLE_SKILL', skill: s })}
              >
                {s.name}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3">
          {ctx.ratings.map((r) => (
            <RatingEditor
              key={r.skillId}
              skillName={nameOf(r.skillId)}
              levels={levelsOf(r.skillId)}
              idPrefix="capture"
              draft={r}
              compact={!desktop}
              collapseIndicators
              canRemove={ctx.ratings.length > 1}
              onChange={(rating) => send({ type: 'UPDATE_RATING', rating })}
              onRemove={() => send({ type: 'REMOVE_SKILL', skillId: r.skillId })}
            />
          ))}
        </div>
        {ctx.ratings.length < MAX_SKILLS_PER_OBSERVATION ? (
          <AddSkill
            exclude={ctx.ratings.map((r) => r.skillId)}
            onAdd={(skill) => send({ type: 'TOGGLE_SKILL', skill })}
          />
        ) : null}
      </StepSection>

      <StepSection step="4" label="Your coaching note">
        <div className="grid gap-4 rounded-card border border-line bg-surface p-4 md:p-5">
          <VoiceNoteBar
            subjectFirstName={first}
            onApply={({ saw, next }) => {
              send({ type: 'SET_SAW', value: saw });
              if (next) send({ type: 'SET_NEXT', value: next });
            }}
          />
          <Field>
            <Label htmlFor="capture-saw">What did {first} do well?</Label>
            <Textarea
              id="capture-saw"
              rows={3}
              value={ctx.narrativeSaw}
              onChange={(e) => send({ type: 'SET_SAW', value: e.target.value })}
              placeholder={`Describe a specific behavior you saw from ${first} and how it landed.`}
              className="narrative min-h-28"
            />
            {short > 0 ? (
              <FieldHint className="tabular">{short} more characters to publish</FieldHint>
            ) : null}
          </Field>
          <Field>
            <Label htmlFor="capture-next">One thing to try next time · optional</Label>
            <Textarea
              id="capture-next"
              rows={2}
              value={ctx.narrativeNext}
              onChange={(e) => send({ type: 'SET_NEXT', value: e.target.value })}
              placeholder="e.g. Ask each spouse separately about trade-offs before summarizing."
              className="narrative min-h-20"
            />
            <FieldHint>No client names or account numbers.</FieldHint>
          </Field>
          {privacy.held ? (
            <AssistantNote>
              This appears to include client details ({privacy.reasons.join('; ').toLowerCase()}).
              Remove them to publish.
            </AssistantNote>
          ) : null}
        </div>
      </StepSection>
    </>
  );
};

const PublishedReceipt = ({
  view,
  onAnother,
}: {
  readonly view: ObservationView;
  readonly onAnother: () => void;
}) => {
  const first = view.subject.displayName.split(' ')[0] ?? '';
  const badge = view.badgesEarned.at(-1);
  return (
    <Page width="reading">
      <Card className="grid animate-fade-up gap-5 p-6 md:p-8">
        <div className="flex items-start gap-4">
          {badge ? (
            <BadgeSeal level={badge.level as 2 | 3} domain={badge.skill.domain} size={56} settle />
          ) : (
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success-soft text-success-ink">
              <CheckCircle2Icon className="size-6" />
            </span>
          )}
          <div className="grid gap-1">
            <h1 className="font-serif text-h1 font-medium text-ink">
              Feedback shared with {first}
            </h1>
            <p className="text-body text-ink-2">
              {first} can read your note right away and it counts toward their skill progress.
            </p>
          </div>
        </div>

        {badge ? (
          <div className="rounded-card border border-brass/40 bg-brass-soft/50 px-4 py-3 text-ui font-medium text-brass-ink">
            Milestone unlocked: this earned {first}’s {badge.skill.name} · {badge.levelName} badge.
          </div>
        ) : null}

        {view.credits.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {view.credits.map((c) => (
              <Pill key={c.skill.id} tone="primary">
                {c.skill.name} · {c.levelName}
              </Pill>
            ))}
          </div>
        ) : null}

        {view.narrativeSaw ? (
          <blockquote className="narrative border-l-2 border-brass pl-4 text-ink">
            “{view.narrativeSaw}”
          </blockquote>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="primary" onClick={onAnother}>
            <MessageSquarePlusIcon /> Give feedback to someone else
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </Card>
    </Page>
  );
};

const publishFeedbackEffect = (ctx: GiveFeedbackContext) => {
  if (!ctx.target) return Effect.die('target required');
  return callEffect('observations', 'publishQuick', {
    payload: {
      subjectId: ctx.target.person.id,
      activityId: ctx.activityId,
      title: ctx.title.trim() || null,
      occurredOn: occurredOnOf(ctx),
      kind: ctx.kind,
      mode: ctx.mode,
      ratings: ctx.ratings.map((r) => ({
        skillId: r.skillId,
        level: r.level,
        indicatorIds: [...r.indicatorIds],
        credit: r.credit,
      })),
      narrativeSaw: ctx.narrativeSaw.trim(),
      narrativeNext: ctx.narrativeNext.trim(),
    },
  });
};

const saveDraftEffect = (ctx: GiveFeedbackContext) => {
  if (!ctx.target) return Effect.die('target required');
  return callEffect('observations', 'start', {
    payload: {
      subjectId: ctx.target.person.id,
      activityId: ctx.activityId,
      title: ctx.title.trim() || null,
      occurredOn: occurredOnOf(ctx),
      kind: ctx.kind,
      mode: ctx.mode,
      skillIds: ctx.ratings.map((r) => r.skillId),
    },
  }).pipe(
    Effect.flatMap((started) =>
      callEffect('observations', 'saveDraft', {
        params: { id: started.id },
        payload: {
          version: started.version,
          mode: ctx.mode,
          ratings: ctx.ratings.map((r) => ({
            skillId: r.skillId,
            level: r.level,
            indicatorIds: [...r.indicatorIds],
            credit: r.credit,
          })),
          narrativeSaw: ctx.narrativeSaw,
          narrativeNext: ctx.narrativeNext,
        },
      }),
    ),
  );
};

const CaptureBar = ({
  missing,
  first,
  canDraft,
  publishing,
  savingDraft,
  onSaveDraft,
  onPublish,
}: {
  readonly missing: string | null;
  readonly first: string;
  readonly canDraft: boolean;
  readonly publishing: boolean;
  readonly savingDraft: boolean;
  readonly onSaveDraft: () => void;
  readonly onPublish: () => void;
}) => {
  const busy = publishing || savingDraft;
  return (
    <div className="sticky bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 -mx-4 mt-8 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6 lg:bottom-0 xl:-mx-8 xl:px-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p aria-live="polite" className="w-full text-meta text-ink-3 sm:w-auto sm:flex-1">
          {missing ?? `Ready to share with ${first}.`}
        </p>
        <Button variant="ghost" disabled={!canDraft || busy} onClick={onSaveDraft}>
          {savingDraft ? 'Saving…' : 'Save draft'}
        </Button>
        <Button
          variant="primary"
          className="ml-auto px-6 sm:ml-0"
          disabled={missing !== null || busy}
          onClick={onPublish}
        >
          {publishing ? 'Publishing…' : 'Publish feedback'}
        </Button>
      </div>
    </div>
  );
};

/**
 * "Give feedback" (`/observations/new`): one clean flow powered by XState 5 + Effect.
 * Publishes in a single click via POST /observations/publish-quick — no heavy second modal.
 */
export const ObserveNew = ({
  targets,
  inbox,
  preselect,
}: {
  readonly targets: ReadonlyArray<ObserveTarget>;
  readonly inbox: InboxView | undefined;
  readonly preselect: string | undefined;
}) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const initialTarget = useMemo(
    () => targets.find((t) => t.person.id === preselect) ?? null,
    [targets, preselect],
  );
  const machine = useMemo(() => createGiveFeedbackMachine(initialTarget), [initialTarget]);
  const [snapshot, send] = useMachine(machine);
  const ctx = snapshot.context;

  const ladders = useQueries({
    queries: ctx.skillRefs.map((s) => ({
      ...queryOptions('catalog', 'skill', { params: { slug: s.slug } }),
      staleTime: 5 * 60_000,
    })),
  });
  const levelsOf = (id: string) =>
    ladders[ctx.skillRefs.findIndex((s) => s.id === id)]?.data?.levels ?? [];
  const nameOf = (id: string) => ctx.skillRefs.find((s) => s.id === id)?.name ?? 'Skill';
  const suggestions = useMemo(
    () => [...new Map((ctx.target?.focusSkills ?? []).map((s) => [s.id, s])).values()],
    [ctx.target],
  );

  if (targets.length === 0) {
    return (
      <Page width="reading">
        <PageHeader title="Give feedback" />
        <EmptyState>
          You can give feedback to your direct reports and the people you coach. Nobody is in either
          group yet.
        </EmptyState>
      </Page>
    );
  }

  if (snapshot.matches('published') && ctx.published) {
    return <PublishedReceipt view={ctx.published} onAnother={() => send({ type: 'RESET' })} />;
  }

  const missing = missingToPublish(ctx);
  const busy = snapshot.matches('publishing') || snapshot.matches('savingDraft');
  const first = ctx.target?.person.displayName.split(' ')[0] ?? '';

  const onError = (error: unknown) =>
    Effect.sync(() => {
      const msg = describeError(error);
      send({ type: 'FAILED', message: msg });
      toast.error(msg);
    });

  const publish = () => {
    if (!ctx.target || missing !== null || busy) return;
    send({ type: 'PUBLISH' });
    void Effect.runPromise(
      publishFeedbackEffect(ctx).pipe(
        Effect.tap((view) =>
          Effect.promise(() => qc.invalidateQueries()).pipe(
            Effect.andThen(Effect.sync(() => send({ type: 'PUBLISHED', view }))),
          ),
        ),
        Effect.catch(onError),
      ),
    );
  };

  const saveForLater = () => {
    if (!ctx.target || !canSaveDraft(ctx) || busy) return;
    send({ type: 'SAVE_DRAFT' });
    void Effect.runPromise(
      saveDraftEffect(ctx).pipe(
        Effect.tap(() =>
          Effect.promise(() => qc.invalidateQueries()).pipe(
            Effect.andThen(
              Effect.sync(() => {
                send({ type: 'DRAFT_SAVED' });
                toast.success('Draft saved in Feedback requests.');
                void navigate({ to: '/inbox' });
              }),
            ),
          ),
        ),
        Effect.catch(onError),
      ),
    );
  };

  return (
    <Page width="reading" className="pb-28 md:pb-24">
      <PageHeader
        title="Give feedback"
        description="Share specific coaching feedback from a meeting, recording, or debrief."
      />
      <div className="grid gap-7">
        <StepSection step="1" label="Who are you giving feedback to?">
          <PeoplePicker
            targets={targets}
            selectedId={ctx.target?.person.id ?? null}
            onSelect={(target) => send({ type: 'CHOOSE_PERSON', target })}
          />
          {ctx.target ? <OpenRequestBanner inbox={inbox} target={ctx.target} /> : null}
        </StepSection>
        {ctx.target ? (
          <>
            <ContextSection ctx={ctx} send={send} />
            <SkillsAndNotes
              ctx={ctx}
              send={send}
              suggestions={suggestions}
              levelsOf={levelsOf}
              nameOf={nameOf}
              desktop={desktop}
            />
          </>
        ) : null}
        {ctx.error ? (
          <p role="alert" className="text-ui text-danger-ink">
            {ctx.error}
          </p>
        ) : null}
      </div>
      <CaptureBar
        missing={missing}
        first={first}
        canDraft={canSaveDraft(ctx)}
        publishing={snapshot.matches('publishing')}
        savingDraft={snapshot.matches('savingDraft')}
        onSaveDraft={saveForLater}
        onPublish={publish}
      />
    </Page>
  );
};
