import type { ConversationSummary, ConversationView, ConversationsView } from '@repo/api';
import type { ConversationEventType, PersonId } from '@repo/domain';
import {
  BadgeSeal,
  Button,
  Card,
  EmptyState,
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  PersonAvatar,
  SectionLabel,
  StatusPill,
  toast,
} from '@repo/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeftIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader, SkillChip } from '@/components/page.tsx';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { describeError, useApiMutation } from '@/lib/api.ts';
import { formatDate, formatLongDate, formatTime, kindLabel, todayIso } from '@/lib/format.ts';
import { CONVERSATION_EVENT_LABEL, CONVERSATION_STATUS } from '@/lib/lifecycle-presentation.ts';
import { useSession } from '@/lib/session.ts';
import { CommitmentDialog, CommitmentRow } from './commitments.tsx';

const otherParty = (c: ConversationSummary, me: string) => (c.host.id === me ? c.coachee : c.host);
const basisLabel = (c: ConversationSummary) => (c.basis === 'coach' ? 'Coaching' : '1:1');

/** The next weekday, as the default day for a new conversation. */
const nextWorkday = () => {
  const d = new Date();
  do d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Date and time inputs in the viewer's own time zone; the API takes an instant. */
const WhenFields = ({
  date,
  time,
  onDate,
  onTime,
}: {
  readonly date: string;
  readonly time: string;
  readonly onDate: (v: string) => void;
  readonly onTime: (v: string) => void;
}) => (
  <div className="grid gap-4 sm:grid-cols-2">
    <Field>
      <Label htmlFor="conversation-date">Day</Label>
      <Input
        id="conversation-date"
        type="date"
        min={todayIso()}
        value={date}
        onChange={(e) => onDate(e.target.value)}
      />
    </Field>
    <Field>
      <Label htmlFor="conversation-time">Time</Label>
      <Input
        id="conversation-time"
        type="time"
        step={900}
        value={time}
        onChange={(e) => onTime(e.target.value)}
      />
    </Field>
  </div>
);

/** Whether a chosen moment is still ahead (checked when the form re-renders on input). */
const isFuture = (at: Date | null) => at !== null && at.getTime() > Date.now();

const toInstant = (date: string, time: string) => {
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const ScheduleDialog = ({
  partners,
  open,
  onClose,
}: {
  readonly partners: ConversationsView['partners'];
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const navigate = useNavigate();
  const [withId, setWithId] = useState<PersonId | ''>(partners[0]?.person.id ?? '');
  const [date, setDate] = useState(nextWorkday());
  const [time, setTime] = useState('10:00');
  const [error, setError] = useState<string | null>(null);
  const schedule = useApiMutation('rhythm', 'scheduleConversation', {
    invalidates: ['rhythm', 'support'],
    onSuccess: (view) => {
      onClose();
      void navigate({ to: '/conversations/$id', params: { id: view.id } });
    },
    onError: (e) => setError(describeError(e)),
  });
  const at = toInstant(date, time);
  const future = isFuture(at);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Schedule a conversation"
      description="The agenda builds itself from what happened since your last one."
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!withId || !at || !future) return;
          setError(null);
          schedule.mutate({ payload: { withPersonId: withId, scheduledFor: at.toISOString() } });
        }}
      >
        <Field>
          <Label htmlFor="conversation-with">With</Label>
          <NativeSelect
            id="conversation-with"
            value={withId}
            onChange={(e) => setWithId(e.target.value as PersonId)}
          >
            {partners.map((p) => (
              <option key={p.person.id} value={p.person.id}>
                {p.person.displayName} ·{' '}
                {p.asHost
                  ? `you ${p.basis === 'coach' ? 'coach' : 'lead'} them`
                  : `your ${p.basis === 'coach' ? 'coach' : 'leader'}`}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <WhenFields date={date} time={time} onDate={setDate} onTime={setTime} />
        {at && !future ? <FieldHint>Choose a time that hasn’t passed.</FieldHint> : null}
        {error ? (
          <p role="alert" className="text-ui text-danger-ink">
            Not scheduled. {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!withId || !future || schedule.isPending}
          >
            {schedule.isPending ? 'Scheduling…' : 'Schedule'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

const ConversationRow = ({ c }: { readonly c: ConversationSummary }) => {
  const me = useSession().person.id;
  const other = otherParty(c, me);
  const when = c.heldOn ? formatDate(c.heldOn) : formatDate(c.scheduledFor);
  return (
    <li>
      <Link
        to="/conversations/$id"
        params={{ id: c.id }}
        className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-sunken md:px-5"
      >
        <span className="grid w-16 shrink-0 text-meta text-ink-3 tabular">
          <span className="text-ui text-ink">{when}</span>
          {c.status === 'scheduled' ? formatTime(c.scheduledFor) : null}
        </span>
        <PersonAvatar person={other} size="md" />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-ui font-medium text-ink">{other.displayName}</span>
          <span className="text-meta text-ink-3">
            {basisLabel(c)}
            {c.openCommitments > 0
              ? ` · ${c.openCommitments} open ${c.openCommitments === 1 ? 'commitment' : 'commitments'}`
              : ''}
          </span>
        </span>
        {c.status === 'scheduled' ? null : <StatusPill {...CONVERSATION_STATUS[c.status]} />}
      </Link>
    </li>
  );
};

const ConversationList = ({
  label,
  items,
  empty,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<ConversationSummary>;
  readonly empty: string;
}) => {
  const id = label.toLowerCase().replaceAll(' ', '-');
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <SectionLabel id={id}>{label}</SectionLabel>
      {items.length > 0 ? (
        <Card>
          <ul className="divide-y divide-line">
            {items.map((c) => (
              <ConversationRow key={c.id} c={c} />
            ))}
          </ul>
        </Card>
      ) : (
        <p className="text-ui text-ink-3">{empty}</p>
      )}
    </section>
  );
};

/** Conversations (ADR 0019): coaching sessions and leaders' 1:1s are the same object. */
export const ConversationsScreen = ({ data }: { readonly data: ConversationsView }) => {
  const [scheduling, setScheduling] = useState(false);
  const canSchedule = data.partners.length > 0;
  return (
    <Page width="reading">
      <PageHeader
        title="Conversations"
        description="Coaching sessions and 1:1s. Each agenda gathers what was observed, what was logged and what was promised since the last one."
        actions={
          canSchedule ? (
            <Button variant="primary" onClick={() => setScheduling(true)}>
              <PlusIcon /> Schedule
            </Button>
          ) : null
        }
      />
      {!canSchedule && data.upcoming.length === 0 && data.recent.length === 0 ? (
        <EmptyState>
          Conversations are with your coach, your leader, or the people you coach and lead. Nobody
          is in those groups yet.
        </EmptyState>
      ) : (
        <div className="grid gap-10">
          <ConversationList
            label="Upcoming"
            items={data.upcoming}
            empty="Nothing scheduled. A short conversation every week or two keeps commitments moving."
          />
          <ConversationList
            label="Recent"
            items={data.recent}
            empty="Held conversations appear here."
          />
        </div>
      )}
      {canSchedule ? (
        <ScheduleDialog
          partners={data.partners}
          open={scheduling}
          onClose={() => setScheduling(false)}
        />
      ) : null}
    </Page>
  );
};

const RescheduleDialog = ({
  view,
  open,
  onClose,
}: {
  readonly view: ConversationView;
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const start = new Date(view.scheduledFor);
  const [date, setDate] = useState(view.scheduledFor.slice(0, 10));
  const [time, setTime] = useState(
    `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
  );
  const event = useApiMutation('rhythm', 'conversationEvent', {
    invalidates: ['rhythm', 'support'],
    onSuccess: () => {
      toast.success('Rescheduled.');
      onClose();
    },
  });
  const at = toInstant(date, time);
  const future = isFuture(at);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Reschedule"
      description="Both of you see the new time."
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!at || !future) return;
          event.mutate({
            params: { id: view.id },
            payload: { event: 'RESCHEDULE', version: view.version, scheduledFor: at.toISOString() },
          });
        }}
      >
        <WhenFields date={date} time={time} onDate={setDate} onTime={setTime} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Keep the time
          </Button>
          <Button type="submit" variant="primary" disabled={!future || event.isPending}>
            Reschedule
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

const ACTION_VARIANT = {
  HOLD: 'primary',
  MISS: 'secondary',
  RESCHEDULE: 'secondary',
  CANCEL: 'ghost',
} as const satisfies Record<ConversationEventType, 'primary' | 'secondary' | 'ghost'>;

/** Buttons in a steady order, whatever order the server lists them in. */
const ACTION_ORDER: ReadonlyArray<ConversationEventType> = ['HOLD', 'MISS', 'RESCHEDULE', 'CANCEL'];

const ConversationActions = ({ view }: { readonly view: ConversationView }) => {
  const [rescheduling, setRescheduling] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const event = useApiMutation('rhythm', 'conversationEvent', {
    invalidates: ['rhythm', 'support'],
    onSuccess: (_d, v) => {
      setCanceling(false);
      toast.success(`${CONVERSATION_EVENT_LABEL[v.payload.event]}: done.`);
    },
  });
  const post = (e: ConversationEventType) =>
    event.mutate({ params: { id: view.id }, payload: { event: e, version: view.version } });
  const open: Partial<Record<ConversationEventType, () => void>> = {
    RESCHEDULE: () => setRescheduling(true),
    // Canceling is final, so it asks first.
    CANCEL: () => setCanceling(true),
  };
  const actions = ACTION_ORDER.filter((a) => view.actions.includes(a));
  if (actions.length === 0) return null;
  const first = view.coachee.displayName.split(' ')[0] ?? '';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((a) => (
        <Button
          key={a}
          variant={ACTION_VARIANT[a]}
          disabled={event.isPending}
          onClick={open[a] ?? (() => post(a))}
        >
          {CONVERSATION_EVENT_LABEL[a]}
        </Button>
      ))}
      <RescheduleDialog view={view} open={rescheduling} onClose={() => setRescheduling(false)} />
      <ResponsiveDialog
        open={canceling}
        onOpenChange={(o) => !o && setCanceling(false)}
        title="Cancel this conversation?"
        description={`It can’t be reopened; schedule another when it suits. ${first}’s commitments stay open.`}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setCanceling(false)}>
            Keep it
          </Button>
          <Button variant="secondary" disabled={event.isPending} onClick={() => post('CANCEL')}>
            Cancel conversation
          </Button>
        </div>
      </ResponsiveDialog>
    </div>
  );
};

const AgendaSection = ({
  title,
  children,
  action,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly action?: React.ReactNode;
}) => {
  const id = `agenda-${title.toLowerCase().replaceAll(/[^a-z]+/g, '-')}`;
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-ui font-medium text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
};

const SHOWN_OBSERVATIONS = 6;

const Agenda = ({ view }: { readonly view: ConversationView }) => {
  const me = useSession().person.id;
  const [adding, setAdding] = useState(false);
  const [allObservations, setAllObservations] = useState(false);
  const { agenda } = view;
  const shownObservations = allObservations
    ? agenda.signedObservations
    : agenda.signedObservations.slice(0, SHOWN_OBSERVATIONS);
  const hidden = agenda.signedObservations.length - shownObservations.length;
  // The coachee reads about themselves in the second person.
  const self = view.coachee.id === me;
  const first = view.coachee.displayName.split(' ')[0] ?? '';
  const open = agenda.commitments.filter((c) => c.status === 'open');
  const closed = agenda.commitments.filter((c) => c.status !== 'open');
  return (
    <div className="grid gap-9">
      <AgendaSection
        title={agenda.since ? `Observed since ${formatDate(agenda.since)}` : 'Observed so far'}
      >
        {agenda.signedObservations.length > 0 ? (
          <ul className="divide-y divide-line border-y border-line">
            {shownObservations.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <PersonAvatar person={o.observer} size="sm" />
                <span className="min-w-0 flex-1 basis-48 text-ui text-ink">
                  {o.observer.displayName}
                  <span className="text-ink-3"> · {formatDate(o.occurredOn)}</span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {o.skills.map((s) => (
                    <SkillChip key={s.id} name={s.name} />
                  ))}
                </span>
                <Link
                  to="/observations/$id"
                  params={{ id: o.id }}
                  className="text-meta text-primary-ink hover:underline"
                >
                  Read
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui text-ink-3">No signed observations in this period.</p>
        )}
        {hidden > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setAllObservations(true)}
          >
            Show {hidden} more
          </Button>
        ) : null}
      </AgendaSection>

      <AgendaSection title="Logged, not yet observed">
        {agenda.unobservedInteractions.length > 0 ? (
          <ul className="divide-y divide-line border-y border-line">
            {agenda.unobservedInteractions.map((i) => (
              <li key={i.id} className="flex items-baseline gap-3 py-3 text-ui">
                <span className="w-16 shrink-0 text-meta text-ink-3 tabular">
                  {formatDate(i.occurredOn)}
                </span>
                <span className="min-w-0 flex-1 text-ink">{i.title}</span>
                <span className="text-meta text-ink-3">{kindLabel(i.kind)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui text-ink-3">
            Everything {self ? 'you' : first} logged has been observed.
          </p>
        )}
      </AgendaSection>

      <AgendaSection
        title="Commitments"
        action={
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon /> Add
          </Button>
        }
      >
        {open.length + closed.length > 0 ? (
          <ul className="divide-y divide-line border-y border-line">
            {[...open, ...closed].map((c) => (
              <CommitmentRow key={c.id} commitment={c} showOwner={c.owner.id !== me} />
            ))}
          </ul>
        ) : (
          <p className="text-ui text-ink-3">
            No open commitments. Agree one concrete thing before you finish.
          </p>
        )}
      </AgendaSection>

      {agenda.nextStep ? (
        <AgendaSection title={self ? 'Your next step' : `${first}’s next step`}>
          <Card className="flex items-center gap-4 p-5">
            <BadgeSeal level={0} domain={agenda.nextStep.skill.domain} size={56} />
            <p className="text-body text-ink">{agenda.nextStep.sentence}</p>
          </Card>
        </AgendaSection>
      ) : null}

      <CommitmentDialog
        key={adding ? 'open' : 'closed'}
        open={adding}
        onClose={() => setAdding(false)}
        ownerId={view.coachee.id}
        ownerName={view.coachee.displayName}
        conversationId={view.id}
      />
    </div>
  );
};

export const ConversationScreen = ({ view }: { readonly view: ConversationView }) => {
  const me = useSession().person.id;
  const other = otherParty(view, me);
  return (
    <Page width="reading">
      <Link
        to="/conversations"
        className="mb-4 inline-flex items-center gap-1.5 text-meta text-ink-3 hover:text-ink"
      >
        <ArrowLeftIcon className="size-3.5" /> Conversations
      </Link>
      <header className="mb-10 grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill {...CONVERSATION_STATUS[view.status]} />
          <span className="text-meta text-ink-3">
            {basisLabel(view)} ·{' '}
            {view.heldOn
              ? `held ${formatLongDate(view.heldOn)}`
              : `${formatLongDate(view.scheduledFor)}, ${formatTime(view.scheduledFor)}`}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <PersonAvatar person={other} size="lg" />
          <h1 className="font-serif text-h1 font-medium text-ink md:text-display">
            With {other.displayName}
          </h1>
        </div>
        <ConversationActions view={view} />
      </header>
      <Agenda view={view} />
    </Page>
  );
};
