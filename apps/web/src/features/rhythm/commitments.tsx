import type { CommitmentView } from '@repo/api';
import {
  screenLocally,
  type ConversationId,
  type IsoDate,
  type ObservationId,
  type PersonId,
} from '@repo/domain';
import {
  AssistantNote,
  Button,
  Field,
  FieldHint,
  Input,
  Label,
  PersonAvatar,
  StatusPill,
  Textarea,
  toast,
} from '@repo/ui';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { describeError, useApiMutation } from '@/lib/api.ts';
import { formatDate, todayIso } from '@/lib/format.ts';
import { COMMITMENT_STATUS } from '@/lib/lifecycle-presentation.ts';
import { useSession } from '@/lib/session.ts';

/** A commitment's body: at most this many characters (the contract's limit). */
export const COMMITMENT_MAX = 280;
const COMMITMENT_MIN = 3;

const firstName = (name: string) => name.split(' ')[0] ?? name;

const EVENT_LABEL = { COMPLETE: 'Done', DROP: 'Drop', REOPEN: 'Reopen' } as const;

/**
 * One commitment. Its buttons come only from `actions` (Done, Drop, Reopen),
 * and it never earns credit: it is a promise, not a record of work.
 */
export const CommitmentRow = ({
  commitment,
  showOwner,
}: {
  readonly commitment: CommitmentView;
  readonly showOwner: boolean;
}) => {
  const me = useSession().person.id;
  const event = useApiMutation('rhythm', 'commitmentEvent', {
    onSuccess: (updated, { payload }) => {
      if (payload.event === 'REOPEN' || !updated.actions.includes('REOPEN')) return;
      // A closed commitment may leave the list it was in; offer the way back here.
      toast(payload.event === 'COMPLETE' ? 'Marked done.' : 'Dropped.', {
        action: {
          label: 'Undo',
          onClick: () => event.mutate({ params: { id: updated.id }, payload: { event: 'REOPEN' } }),
        },
      });
    },
  });
  const fromWhom =
    commitment.createdBy.id === me
      ? 'Yours'
      : `From ${firstName(commitment.createdBy.displayName)}`;
  const source = showOwner ? commitment.owner.displayName : fromWhom;
  const closed = commitment.status !== 'open';
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      {showOwner ? <PersonAvatar person={commitment.owner} size="sm" /> : null}
      <div className="min-w-0 flex-1 basis-56">
        <p className={closed ? 'text-ui text-ink-3 line-through' : 'text-ui text-ink'}>
          {commitment.body || 'Commitment (text removed)'}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-meta text-ink-3">
          <span>
            {source}
            {commitment.dueOn ? ` · by ${formatDate(commitment.dueOn)}` : ''}
          </span>
          {closed ? <StatusPill {...COMMITMENT_STATUS[commitment.status]} /> : null}
        </p>
      </div>
      {/* The actions travel together when the row wraps on a phone. */}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {commitment.actions.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === 'COMPLETE' ? 'secondary' : 'ghost'}
            disabled={event.isPending}
            onClick={() => event.mutate({ params: { id: commitment.id }, payload: { event: a } })}
          >
            {EVENT_LABEL[a]}
          </Button>
        ))}
      </span>
    </li>
  );
};

/**
 * Write one commitment: from a conversation, or from an observer's "what next".
 * The text is screened locally before it is sent; a commitment never carries
 * who the client was.
 */
export const CommitmentDialog = ({
  open,
  onClose,
  ownerId,
  ownerName,
  initialBody = '',
  conversationId = null,
  sourceObservationId = null,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ownerId: PersonId;
  readonly ownerName: string;
  readonly initialBody?: string;
  readonly conversationId?: ConversationId | null;
  readonly sourceObservationId?: ObservationId | null;
}) => {
  const me = useSession().person.id;
  const [body, setBody] = useState(initialBody.slice(0, COMMITMENT_MAX));
  const [dueOn, setDueOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation('rhythm', 'createCommitment', {
    invalidates: ['rhythm', 'support'],
    onSuccess: () => {
      toast.success('Commitment added. It carries forward until it is done or dropped.');
      setBody('');
      setDueOn('');
      onClose();
    },
    onError: (e) => setError(describeError(e)),
  });
  const trimmed = body.trim();
  const privacy = screenLocally(trimmed);
  const valid = trimmed.length >= COMMITMENT_MIN && !privacy.held;
  const whose = ownerId === me ? 'Your' : `${firstName(ownerName)}’s`;
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`${whose} commitment`}
      description="One concrete thing to do. It never earns credit; it is followed up in your next conversation."
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          setError(null);
          create.mutate({
            payload: {
              ownerId,
              body: trimmed,
              dueOn: dueOn ? (dueOn as IsoDate) : null,
              conversationId,
              sourceObservationId,
            },
          });
        }}
      >
        <Field>
          <Label htmlFor="commitment-body">What will be done</Label>
          <Textarea
            id="commitment-body"
            rows={3}
            maxLength={COMMITMENT_MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="e.g. Summarise the household’s goal before showing any numbers"
          />
          <FieldHint className="tabular">
            {COMMITMENT_MAX - body.length} characters left · no client names or account details
          </FieldHint>
        </Field>
        {privacy.held ? (
          <AssistantNote>
            This appears to include client details ({privacy.reasons.join('; ').toLowerCase()}).
            Remove them to save.
          </AssistantNote>
        ) : null}
        <Field>
          <Label htmlFor="commitment-due">By · optional</Label>
          <Input
            id="commitment-due"
            type="date"
            min={todayIso()}
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="w-auto"
          />
        </Field>
        {error ? (
          <p role="alert" className="text-ui text-danger-ink">
            Not saved. {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || create.isPending}>
            {create.isPending ? 'Saving…' : 'Add commitment'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};
