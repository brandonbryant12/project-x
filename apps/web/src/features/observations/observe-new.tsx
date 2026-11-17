import type { InboxView, ObserveTarget, ObserveTargets } from '@repo/api';
import {
  INTERACTION_KINDS,
  OBSERVATION_MODE_LABELS,
  OBSERVATION_MODES,
  OBSERVE_WINDOW_DAYS,
  type InteractionKind,
} from '@repo/domain';
import {
  AssistantNote,
  Button,
  cn,
  EmptyState,
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  PersonAvatar,
  Textarea,
  toast,
} from '@repo/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Page, PageHeader } from '@/components/page.tsx';
import { describeError } from '@/lib/api.ts';
import { daysAgoIso, formatDate, formatLongDate, kindLabel, todayIso } from '@/lib/format.ts';
import { useIsDesktop } from '@/lib/use-media.ts';
import { AddSkill, RatingEditor } from './parts.tsx';
import { ReviewAndSignDialog } from './review-dialog.tsx';
import { MIN_SAW } from './use-observation-draft.ts';
import { useQuickCapture, type QuickCapture, type When } from './use-quick-capture.ts';

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
      'inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-full border px-3.5 text-left text-ui transition-colors md:min-h-9',
      on
        ? 'border-primary bg-primary-soft text-primary-ink'
        : 'border-line bg-surface text-ink-2 hover:bg-sunken',
    )}
  >
    {children}
  </button>
);

const Row = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2.5">
      <h2 id={id} className="text-ui font-medium text-ink">
        {label}
      </h2>
      {children}
    </section>
  );
};

const inlineLink = 'text-primary-ink underline-offset-4 hover:underline';
const SHOWN_PEOPLE = 6;

/** Points at an open request or draft for the chosen person, so they answer it instead. */
const OpenItemNote = ({
  inbox,
  personId,
  first,
}: {
  readonly inbox: InboxView | undefined;
  readonly personId: string;
  readonly first: string;
}) => {
  const request = inbox?.requests.find((r) => r.subject.id === personId);
  if (request) {
    return (
      <p className="text-ui text-ink-2">
        {first} asked you to look at {request.activityTitle} from {formatDate(request.occurredOn)}.{' '}
        <Link to="/observations/$id" params={{ id: request.id }} className={inlineLink}>
          Answer that request
        </Link>
      </p>
    );
  }
  const draft = inbox?.drafts.find((r) => r.subject.id === personId);
  if (!draft) return null;
  return (
    <p className="text-ui text-ink-2">
      You have a draft about {first} from {formatDate(draft.occurredOn)}.{' '}
      <Link to="/observations/$id" params={{ id: draft.id }} className={inlineLink}>
        Finish that one
      </Link>
    </p>
  );
};

const WhoRow = ({
  capture,
  inbox,
}: {
  readonly capture: QuickCapture;
  readonly inbox: InboxView | undefined;
}) => {
  const [showAll, setShowAll] = useState(false);
  const { people, target, locked } = capture;
  const visible =
    showAll || people.length <= SHOWN_PEOPLE + 2 ? people : people.slice(0, SHOWN_PEOPLE);
  if (locked && target) {
    return (
      <Row label="Who">
        <p className="flex items-center gap-2 text-ui text-ink">
          <PersonAvatar person={target.person} size="xs" />
          {target.person.displayName}
          <span className="text-meta text-ink-3">· saved as your draft</span>
        </p>
      </Row>
    );
  }
  return (
    <Row label="Who">
      <div className="flex flex-wrap gap-2">
        {visible.map((t) => (
          <Chip
            key={t.person.id}
            on={t.person.id === target?.person.id}
            onClick={() => capture.choosePerson(t)}
          >
            <PersonAvatar person={t.person} size="xs" />
            <span className="truncate">{t.person.displayName}</span>
          </Chip>
        ))}
        {visible.length < people.length ? (
          <Chip on={false} onClick={() => setShowAll(true)}>
            Everyone ({people.length})
          </Chip>
        ) : null}
      </div>
      {target ? (
        <OpenItemNote
          inbox={inbox}
          personId={target.person.id}
          first={target.person.displayName.split(' ')[0] ?? ''}
        />
      ) : null}
    </Row>
  );
};

/**
 * Work the person already logged that day (title and kind only). Observing it
 * attaches to that work, so the same meeting is never counted twice.
 */
const LoggedWork = ({
  capture,
  first,
}: {
  readonly capture: QuickCapture;
  readonly first: string;
}) => {
  const { loggedThatDay, work } = capture;
  if (loggedThatDay.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className="text-ui text-ink-2">
        {first} already logged work that day. If you saw it, choose it so it counts once.
      </p>
      <div className="flex flex-wrap gap-2">
        {loggedThatDay.map((w) => (
          <Chip
            key={w.id}
            on={w.id === work?.id}
            onClick={() => capture.chooseWork(w.id === work?.id ? null : w.id)}
          >
            {w.title}
            <span className="text-meta text-ink-3">· {kindLabel(w.kind)}</span>
          </Chip>
        ))}
        <Chip on={work === undefined} onClick={() => capture.chooseWork(null)}>
          Different work
        </Chip>
      </div>
    </div>
  );
};

const WorkRow = ({
  capture,
  target,
  first,
}: {
  readonly capture: QuickCapture;
  readonly target: ObserveTarget;
  readonly first: string;
}) => {
  const { activity, activityId, kind, title, work } = capture;
  const { activities } = target;
  if (capture.locked) {
    return (
      <Row label="The work">
        <p className="text-ui text-ink-2">
          {work?.title ?? activity?.title ?? (title.trim() || kindLabel(kind))} ·{' '}
          {formatLongDate(capture.occurredOn)}
        </p>
      </Row>
    );
  }
  return (
    <Row label="The work">
      <LoggedWork capture={capture} first={first} />
      {work ? null : <NewWork capture={capture} activities={activities} activityId={activityId} />}
    </Row>
  );
};

const NewWork = ({
  capture,
  activities,
  activityId,
}: {
  readonly capture: QuickCapture;
  readonly activities: ObserveTarget['activities'];
  readonly activityId: ObserveTarget['activities'][number]['id'] | null;
}) => {
  const { activity, kind, title } = capture;
  return (
    <>
      {activities.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {activities.map((a) => (
            <Chip
              key={a.id}
              on={a.id === activityId}
              onClick={() => capture.chooseActivity(a.id === activityId ? null : a.id)}
            >
              {a.title}
            </Chip>
          ))}
          <Chip on={activityId === null} onClick={() => capture.chooseActivity(null)}>
            Something else
          </Chip>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <NativeSelect
          aria-label="Kind of work"
          value={kind}
          onChange={(e) => capture.setKind(e.target.value as InteractionKind)}
          className="h-11 md:h-9"
        >
          {INTERACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </NativeSelect>
        {activity ? null : (
          <Input
            aria-label="Name the work (optional)"
            placeholder="Name it (optional), e.g. Annual review"
            value={title}
            maxLength={120}
            onChange={(e) => capture.setTitle(e.target.value)}
            className="h-11 md:h-9"
          />
        )}
      </div>
    </>
  );
};

const WHEN: ReadonlyArray<readonly [When, string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['earlier', 'Earlier'],
];

const WhenRow = ({ capture }: { readonly capture: QuickCapture }) => (
  <Row label="When">
    <div className="flex flex-wrap items-center gap-2">
      {WHEN.map(([value, label]) => (
        <Chip key={value} on={capture.when === value} onClick={() => capture.chooseWhen(value)}>
          {label}
        </Chip>
      ))}
      {capture.when === 'earlier' ? (
        <Input
          type="date"
          aria-label="Date of the work"
          min={daysAgoIso(OBSERVE_WINDOW_DAYS)}
          max={todayIso()}
          value={capture.earlier}
          onChange={(e) => capture.chooseEarlier(e.target.value)}
          className="h-11 w-auto md:h-9"
        />
      ) : (
        <span className="text-meta text-ink-3">{formatLongDate(capture.occurredOn)}</span>
      )}
    </div>
    {capture.outsideWindow ? (
      <FieldHint className="text-warning-ink">
        You can record work from the last {OBSERVE_WINDOW_DAYS} days.
      </FieldHint>
    ) : null}
  </Row>
);

const ModeRow = ({ capture }: { readonly capture: QuickCapture }) => (
  <Row label="How you know">
    <div role="group" aria-label="How you know" className="flex flex-wrap gap-2">
      {OBSERVATION_MODES.map((m) => (
        <Chip
          key={m}
          on={capture.draft.mode === m}
          onClick={() => capture.setDraft((d) => ({ ...d, mode: m }))}
        >
          {OBSERVATION_MODE_LABELS[m]}
        </Chip>
      ))}
    </div>
    <FieldHint>Only what you saw or reviewed yourself counts as first-hand.</FieldHint>
  </Row>
);

const SkillsRow = ({
  capture,
  first,
}: {
  readonly capture: QuickCapture;
  readonly first: string;
}) => {
  const desktop = useIsDesktop();
  const { draft } = capture;
  return (
    <Row label="Skills you saw">
      <FieldHint>
        Mark what the work was mainly about as primary; the others are secondary. At most one is
        primary.
      </FieldHint>
      {capture.suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {capture.suggestions.map((s) => (
            <Chip
              key={s.id}
              on={draft.ratings.some((r) => r.skillId === s.id)}
              onClick={() => capture.toggleSkill(s)}
            >
              {s.name}
            </Chip>
          ))}
        </div>
      ) : (
        <FieldHint>
          {first} has no focus skills yet. Add the skill you saw from the catalog.
        </FieldHint>
      )}
      <div className="grid gap-3">
        {draft.ratings.map((r) => (
          <RatingEditor
            key={r.skillId}
            skillName={capture.nameOf(r.skillId)}
            levels={capture.levelsOf(r.skillId)}
            idPrefix="capture"
            draft={r}
            compact={!desktop}
            collapseIndicators
            canRemove={draft.ratings.length > 1}
            onChange={(next) =>
              capture.setDraft((d) => ({
                ...d,
                ratings: d.ratings.map((x) => (x.skillId === r.skillId ? next : x)),
              }))
            }
            onRemove={() => capture.removeSkill(r.skillId)}
            onRole={(role) => capture.chooseRole(r.skillId, role)}
          />
        ))}
      </div>
      {capture.full ? (
        <FieldHint>An observation rates up to {capture.maxSkills} skills.</FieldHint>
      ) : (
        <AddSkill
          exclude={draft.ratings.map((r) => r.skillId)}
          onAdd={(skill) => capture.toggleSkill(skill)}
        />
      )}
    </Row>
  );
};

/** Plain text fields: the phone's own dictation works here; nothing is recorded as audio. */
const Comments = ({
  capture,
  first,
}: {
  readonly capture: QuickCapture;
  readonly first: string;
}) => {
  const { draft, setDraft, privacy } = capture;
  const short = MIN_SAW - draft.narrativeSaw.trim().length;
  return (
    <>
      <Field>
        <Label htmlFor="capture-saw">What I saw</Label>
        <Textarea
          id="capture-saw"
          rows={4}
          value={draft.narrativeSaw}
          onChange={(e) => setDraft((d) => ({ ...d, narrativeSaw: e.target.value }))}
          placeholder={`What did ${first} do, and what did it lead to?`}
          className="narrative min-h-32"
        />
        {short > 0 ? (
          <FieldHint className="tabular">{short} more characters to sign</FieldHint>
        ) : null}
      </Field>
      <Field>
        <Label htmlFor="capture-next">What next</Label>
        <Textarea
          id="capture-next"
          rows={2}
          value={draft.narrativeNext}
          onChange={(e) => setDraft((d) => ({ ...d, narrativeNext: e.target.value }))}
          placeholder="One concrete thing to try next time"
          className="narrative min-h-20"
        />
      </Field>
      {privacy.held ? (
        <AssistantNote>
          This appears to include client details ({privacy.reasons.join('; ').toLowerCase()}).
          Remove them to sign. Notes carry what {first} did, never who the client was.
        </AssistantNote>
      ) : null}
    </>
  );
};

const CaptureBar = ({
  capture,
  first,
  onSign,
}: {
  readonly capture: QuickCapture;
  readonly first: string;
  readonly onSign: () => void;
}) => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const finishLater = async () => {
    setSaving(true);
    try {
      const saved = await capture.saveDraft();
      toast.success(
        `Saved for later. It waits in Needs you until ${formatDate(saved.dueAt)}, then expires.`,
      );
      void navigate({ to: '/' });
    } catch (error) {
      toast.error(`Not saved. ${describeError(error)}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="sticky bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 -mx-4 mt-8 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6 lg:bottom-0 xl:-mx-8 xl:px-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p aria-live="polite" className="w-full text-meta text-ink-3 sm:w-auto sm:flex-1">
          {capture.missing ?? `Ready to sign for ${first}.`}
        </p>
        <Button
          variant="ghost"
          className="h-11 md:h-9"
          disabled={!capture.canSaveForLater || saving}
          onClick={() => void finishLater()}
        >
          {saving ? 'Saving…' : 'Save and finish later'}
        </Button>
        <Button
          variant="primary"
          className="ml-auto h-11 px-6 sm:ml-0 md:h-9"
          disabled={capture.missing !== null || saving}
          onClick={onSign}
        >
          Sign
        </Button>
      </div>
    </div>
  );
};

/**
 * "I saw this" (path to A, quick capture): one screen from tap to signed.
 * Who, the work, when, how you know, the level against the skill's own ladder,
 * and what you saw. Nothing is written until the observer signs or saves.
 */
export const ObserveNew = ({
  targets,
  inbox,
  preselect,
}: {
  readonly targets: ObserveTargets;
  readonly inbox: InboxView | undefined;
  readonly preselect: string | undefined;
}) => {
  const capture = useQuickCapture(targets, inbox, preselect);
  const [reviewing, setReviewing] = useState(false);
  const { target } = capture;
  const first = target?.person.displayName.split(' ')[0] ?? '';

  if (targets.people.length === 0) {
    return (
      <Page width="reading">
        <PageHeader title="I saw this" />
        <EmptyState>
          You can observe your direct reports and the people you coach. Nobody is in either group
          yet.
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page width="reading" className="pb-0 md:pb-0">
      <PageHeader title="I saw this" description="Write it down while it is fresh." />
      <div className="grid gap-7">
        <WhoRow capture={capture} inbox={inbox} />
        {target ? (
          <>
            {/* When before the work: the work already logged that day is offered first. */}
            {capture.locked ? null : <WhenRow capture={capture} />}
            <WorkRow capture={capture} target={target} first={first} />
            <ModeRow capture={capture} />
            <SkillsRow capture={capture} first={first} />
            <Comments capture={capture} first={first} />
          </>
        ) : null}
      </div>
      <CaptureBar capture={capture} first={first} onSign={() => setReviewing(true)} />
      {target ? (
        <ReviewAndSignDialog
          open={reviewing}
          onOpenChange={setReviewing}
          subjectName={target.person.displayName}
          occurredOn={capture.occurredOn}
          draft={capture.draft}
          skillName={capture.nameOf}
          onSign={capture.sign}
          afterSigning="/"
        />
      ) : null}
    </Page>
  );
};
