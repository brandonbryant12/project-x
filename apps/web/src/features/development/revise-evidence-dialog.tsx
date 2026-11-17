import { Button, Field, FieldHint, Label, Skeleton, Textarea, toast } from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';

/**
 * What is true after a revision (ADR 0008: the assistant may still hold text
 * the first, local screen let through, but never clears anything).
 */
const revisedMessage = (status: string | undefined) => {
  if (status === 'held')
    return 'Saved, and still held: it appears to include client details. Nobody else sees it until it clears.';
  if (status === 'screening')
    return 'Saved. It is being checked for privacy and is shared once it clears. It may still be held.';
  return 'Saved. It passed the first privacy check, so those observing this work can read it. A further check may still hold it for review.';
};

/**
 * The author revises their reflection: when it is held for privacy (ADR 0012),
 * or when an observer sent a request back. Revising sends it back through
 * screening; held text is shared with nobody until it clears.
 */
export const ReviseEvidenceDialog = ({
  interactionId,
  onClose,
}: {
  readonly interactionId: string | null;
  readonly onClose: () => void;
}) => {
  const view = useQuery({
    ...queryOptions('development', 'interaction', {
      params: { id: (interactionId ?? '') as never },
    }),
    enabled: interactionId !== null,
  });
  const [body, setBody] = useState<string | null>(null);
  const text = body ?? view.data?.evidence?.body ?? '';
  const held = view.data?.evidence?.status === 'held';
  const submitLabel = held ? 'Send for privacy check' : 'Save reflection';
  const revise = useApiMutation('development', 'reviseEvidence', {
    onSuccess: (result) => {
      toast.success(revisedMessage(result.evidence?.status));
      setBody(null);
      onClose();
    },
  });
  return (
    <ResponsiveDialog
      open={interactionId !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Revise your reflection"
      description={
        held
          ? 'Held for privacy. This appears to include client details, so it hasn’t been shared with anyone. Remove names and account information to send it.'
          : 'Say more about what happened. It is checked for privacy again, and nobody sees it while it is held.'
      }
    >
      {view.data ? (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (interactionId)
              revise.mutate({
                params: { id: interactionId as never },
                payload: { body: text.trim() },
              });
          }}
        >
          {held && view.data.evidence?.holdReason ? (
            <p className="text-ui text-ink-2">{view.data.evidence.holdReason}</p>
          ) : null}
          <Field>
            <Label htmlFor="revise-body">What happened</Label>
            <Textarea
              id="revise-body"
              rows={5}
              value={text}
              onChange={(e) => setBody(e.target.value)}
            />
            <FieldHint>Describe what you did, not who the client was.</FieldHint>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={text.trim().length < 10 || revise.isPending}
            >
              {revise.isPending ? 'Checking…' : submitLabel}
            </Button>
          </div>
        </form>
      ) : (
        <Skeleton className="h-32" aria-busy="true" />
      )}
    </ResponsiveDialog>
  );
};
