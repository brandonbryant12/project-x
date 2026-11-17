import { Button, Field, FieldHint, Label, Skeleton, Textarea, toast } from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';

/**
 * Held for privacy (ADR 0012): only the author sees the text. Revising sends it
 * back through screening; nothing is shared until it clears.
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
  const revise = useApiMutation('development', 'reviseEvidence', {
    onSuccess: (result) => {
      toast.success(
        result.evidence?.status === 'held'
          ? 'Still held. It appears to include client details.'
          : 'Revised. It is being checked for privacy and will be shared when clear.',
      );
      setBody(null);
      onClose();
    },
  });
  return (
    <ResponsiveDialog
      open={interactionId !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Revise your reflection"
      description="Held for privacy. This appears to include client details, so it hasn’t been shared with anyone. Remove names and account information to send it."
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
          {view.data.evidence?.holdReason ? (
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
              {revise.isPending ? 'Checking…' : 'Send for privacy check'}
            </Button>
          </div>
        </form>
      ) : (
        <Skeleton className="h-32" aria-busy="true" />
      )}
    </ResponsiveDialog>
  );
};
