import type { ObservationView } from '@repo/api';
import {
  Button,
  Card,
  DueLabel,
  Field,
  FieldHint,
  Label,
  StatusPill,
  Textarea,
  toast,
} from '@repo/ui';
import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { useState } from 'react';
import { Page } from '@/components/page.tsx';
import { ReviseEvidenceDialog } from '@/features/development/revise-evidence-dialog.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { formatLongDate } from '@/lib/format.ts';
import { OBSERVATION_STATUS } from '@/lib/lifecycle-presentation.ts';
import { NOTE_EVENTS, NoteEventDialog, type NoteEvent } from './event-dialog.tsx';
import { EvidenceCard, PeopleLine, RatingRead } from './parts.tsx';

/** Resending has its own panel (a note may go with it); these are one tap. */
const SIMPLE_EVENTS = {
  ACKNOWLEDGE: 'Acknowledge',
  WITHDRAW: 'Withdraw request',
  START: 'Start observing',
} as const;

const REQUEST_NOTE_MAX = 280;

/**
 * The returned loop (design §9): the observer's note, the reflection with a way
 * to revise it, and a resend with an optional new note. "Resend" appears only
 * when the view allows it, so never while the reflection is held for privacy.
 */
const ReturnedPanel = ({
  view,
  pending,
  onResend,
}: {
  readonly view: ObservationView;
  readonly pending: boolean;
  readonly onResend: (note: string | null) => void;
}) => {
  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState('');
  const observer = view.observer.displayName.split(' ')[0] ?? view.observer.displayName;
  const canResend = view.actions.includes('RESUBMIT');
  const held = view.evidence?.status === 'held';
  if (!canResend && !view.canReviseEvidence) return null;
  return (
    <section aria-labelledby="resend-heading" className="mt-8 grid gap-4 border-t border-line pt-6">
      <h2 id="resend-heading" className="text-ui font-medium text-ink">
        Revise and resend
      </h2>
      {view.canReviseEvidence ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setRevising(true)}>
            Revise your reflection
          </Button>
          <p className="text-meta text-ink-3">
            It is checked for privacy again before {observer} sees it.
          </p>
        </div>
      ) : null}
      {canResend ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onResend(note.trim() || null);
          }}
        >
          <Field>
            <Label htmlFor="resend-note">New note to {observer} · optional</Label>
            <Textarea
              id="resend-note"
              rows={2}
              maxLength={REQUEST_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <FieldHint>
              {view.requestNote
                ? 'Leave it empty to keep your earlier note. No client names or account details.'
                : 'No client names or account details.'}
            </FieldHint>
          </Field>
          <Button type="submit" variant="primary" className="justify-self-start" disabled={pending}>
            {pending ? 'Sending…' : `Resend to ${observer}`}
          </Button>
        </form>
      ) : null}
      {!canResend && held ? (
        <p role="status" className="text-ui text-ink-2">
          Your reflection is held for privacy, so it can’t go to {observer} yet. Revise it to remove
          client details, then resend.
        </p>
      ) : null}
      <ReviseEvidenceDialog
        interactionId={revising ? view.interaction.id : null}
        onClose={() => setRevising(false)}
      />
    </section>
  );
};

const statusLine = (view: ObservationView) => {
  const observer = view.observer.displayName.split(' ')[0];
  switch (view.status) {
    case 'requested':
      return `Waiting for ${observer} to observe.`;
    case 'drafting':
      return `${observer} has started.`;
    case 'returned':
      return `${observer} sent this back.`;
    case 'signed':
      return view.signedAt
        ? `Signed by ${view.observer.displayName} on ${formatLongDate(view.signedAt)}.`
        : 'Signed.';
    case 'under_review':
      return 'Under review. Credit stands while it is reviewed.';
    case 'declined':
      return `${observer} declined this request.`;
    case 'withdrawn':
      return 'This request was withdrawn.';
    case 'expired':
      return 'This request closed without a signature. The work is still in your plan. You can ask again, or ask someone else.';
    case 'voided':
      return 'This observation was voided and its credit reversed.';
  }
};

/** Everyone who is not actively drafting it: the subject, leaders, and the observer after signing. */
export const ReadView = ({ view }: { readonly view: ObservationView }) => {
  const [noteEvent, setNoteEvent] = useState<NoteEvent | null>(null);
  const transition = useApiMutation('observations', 'transition', {
    onSuccess: () => {
      setNoteEvent(null);
      toast.success('Done.');
    },
  });
  const simple = view.actions.filter((a): a is keyof typeof SIMPLE_EVENTS => a in SIMPLE_EVENTS);
  const withNote = view.actions.filter((a): a is NoteEvent => a in NOTE_EVENTS);
  const signed =
    view.status === 'signed' || view.status === 'under_review' || view.status === 'voided';
  const first = view.subject.displayName.split(' ')[0] ?? '';

  return (
    <Page width="reading">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild aria-label="Back">
          <Link to={view.viewerRole === 'observer' ? '/inbox' : '/development'}>
            <ArrowLeftIcon />
          </Link>
        </Button>
        <StatusPill {...OBSERVATION_STATUS[view.status]} />
        {view.status === 'requested' || view.status === 'drafting' || view.status === 'returned' ? (
          <DueLabel dueAt={view.dueAt} />
        ) : null}
      </div>
      <h1 className="font-serif text-h1 font-medium text-ink md:text-display">
        {view.interaction.activityTitle}
      </h1>
      <p className="mt-2 text-body text-ink-2">{statusLine(view)}</p>
      <div className="mt-6">
        <PeopleLine view={view} />
      </div>

      {view.returnNote && view.status === 'returned' ? (
        <Card className="mt-6 border-warning/40 bg-warning-soft/40 px-5 py-4">
          <p className="text-ui text-ink-2">
            {view.observer.displayName.split(' ')[0]} sent this back with a note:
          </p>
          <p className="narrative mt-1 text-ink">“{view.returnNote}”</p>
        </Card>
      ) : null}
      {view.declineReason && view.status === 'declined' ? (
        <p className="mt-6 text-ui text-ink-2">Reason: {view.declineReason}</p>
      ) : null}

      {signed ? (
        <section className="mt-8 grid gap-5 border-t border-line pt-8">
          <h2 className="text-meta font-medium text-ink-3">
            What {view.observer.displayName.split(' ')[0]} saw
          </h2>
          <div className="grid gap-4">
            {view.ratings.map((r) => (
              <RatingRead
                key={r.skill.id}
                rating={r}
                credit={view.credits.find((c) => c.skill.id === r.skill.id)}
              />
            ))}
          </div>
          {view.narrativeVisible ? (
            <figure className="grid gap-3">
              <blockquote className="narrative border-l-2 border-brass pl-4 text-ink">
                {view.narrativeSaw}
              </blockquote>
              {view.narrativeNext ? (
                <p className="text-ui text-ink-2">
                  <span className="font-medium text-ink">Next: </span>
                  {view.narrativeNext}
                </p>
              ) : null}
              <figcaption className="text-meta text-ink-3">
                — {view.observer.displayName}
              </figcaption>
            </figure>
          ) : (
            <p className="text-ui text-ink-3">
              Narratives are visible to {first}, their coaches and their direct leader.
            </p>
          )}
          {view.acknowledgedAt ? (
            <p className="text-meta text-ink-3">
              {first} acknowledged this on {formatLongDate(view.acknowledgedAt)}.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-8 grid gap-5 border-t border-line pt-8">
        <EvidenceCard view={view} showTitle={false} />
      </section>

      {view.status === 'returned' ? (
        <ReturnedPanel
          view={view}
          pending={transition.isPending}
          onResend={(note) =>
            transition.mutate({ params: { id: view.id }, payload: { event: 'RESUBMIT', note } })
          }
        />
      ) : null}

      {simple.length + withNote.length > 0 ? (
        <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-6">
          {simple.map((a) => (
            <Button
              key={a}
              variant={a === 'ACKNOWLEDGE' ? 'primary' : 'secondary'}
              disabled={transition.isPending}
              onClick={() =>
                transition.mutate({ params: { id: view.id }, payload: { event: a, note: null } })
              }
            >
              {SIMPLE_EVENTS[a]}
            </Button>
          ))}
          {withNote.map((a) => (
            <Button key={a} variant="ghost" onClick={() => setNoteEvent(a)}>
              {NOTE_EVENTS[a].label}
            </Button>
          ))}
        </div>
      ) : null}
      <NoteEventDialog
        event={noteEvent}
        pending={transition.isPending}
        onClose={() => setNoteEvent(null)}
        onSubmit={(event, note) =>
          transition.mutate({ params: { id: view.id }, payload: { event, note: note || null } })
        }
      />
    </Page>
  );
};
