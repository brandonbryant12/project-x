import type { ObservationView } from '@repo/api';
import { Button, Card, DueLabel, StatusPill, toast } from '@repo/ui';
import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon, ListPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Page } from '@/components/page.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { formatLongDate } from '@/lib/format.ts';
import { OBSERVATION_STATUS } from '@/lib/lifecycle-presentation.ts';
import { CommitmentDialog } from '@/features/rhythm/commitments.tsx';
import { NOTE_EVENTS, NoteEventDialog, type NoteEvent } from './event-dialog.tsx';
import { EvidenceCard, PeopleLine, RatingRead } from './parts.tsx';

const SIMPLE_EVENTS = {
  ACKNOWLEDGE: 'Acknowledge',
  RESUBMIT: 'Resend',
  WITHDRAW: 'Withdraw request',
  START: 'Start observing',
} as const;

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
  const [committing, setCommitting] = useState(false);
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
              <RatingRead key={r.skill.id} rating={r} />
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
          {view.status === 'signed' &&
          view.narrativeVisible &&
          (view.viewerRole === 'subject' || view.viewerRole === 'observer') ? (
            <Button
              variant="secondary"
              size="sm"
              className="justify-self-start"
              onClick={() => setCommitting(true)}
            >
              <ListPlusIcon /> Make this a commitment
            </Button>
          ) : null}
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

      {simple.length + withNote.length > 0 ? (
        <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-6">
          {simple.map((a) => (
            <Button
              key={a}
              variant={a === 'ACKNOWLEDGE' || a === 'RESUBMIT' ? 'primary' : 'secondary'}
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
      <CommitmentDialog
        key={committing ? 'open' : 'closed'}
        open={committing}
        onClose={() => setCommitting(false)}
        ownerId={view.subject.id}
        ownerName={view.subject.displayName}
        initialBody={view.narrativeNext}
        sourceObservationId={view.id}
      />
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
