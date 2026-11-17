import type { ObservationEventType } from '@repo/api';
import { Button, Field, FieldHint, Label, NativeSelect, Textarea } from '@repo/ui';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';

/** Events that ask the person "why" — the note becomes part of the record (ADR 0015). */
export const NOTE_EVENTS = {
  RETURN: {
    label: 'Send back',
    title: 'Send this back',
    description:
      'Say what would help you sign. They can revise their reflection and resend it to you.',
    presets: [] as ReadonlyArray<string>,
  },
  DECLINE: {
    label: 'Decline',
    title: 'Decline this request',
    description: 'They will be able to ask someone else.',
    presets: ['I wasn’t there', 'Not enough to go on', 'Someone else is better placed'],
  },
  REQUEST_REVIEW: {
    label: 'Ask for a review',
    title: 'Ask for a review',
    description: 'A reviewer will look at this observation. Credit stands while it is reviewed.',
    presets: [] as ReadonlyArray<string>,
  },
  VOID: {
    label: 'Void',
    title: 'Void this observation',
    description: 'Voiding reverses its credit and is recorded with your reason.',
    presets: [] as ReadonlyArray<string>,
  },
  UPHOLD: {
    label: 'Uphold',
    title: 'Uphold this observation',
    description: 'The observation stands as signed.',
    presets: [] as ReadonlyArray<string>,
  },
} as const satisfies Partial<Record<ObservationEventType, unknown>>;

export type NoteEvent = keyof typeof NOTE_EVENTS;

export const NoteEventDialog = ({
  event,
  onClose,
  onSubmit,
  pending,
}: {
  readonly event: NoteEvent | null;
  readonly onClose: () => void;
  readonly onSubmit: (event: NoteEvent, note: string) => void;
  readonly pending: boolean;
}) => {
  const [note, setNote] = useState('');
  const [preset, setPreset] = useState('');
  if (!event) return null;
  const spec = NOTE_EVENTS[event];
  const text = preset && preset !== 'Other' ? `${preset}${note ? `. ${note}` : ''}` : note;
  const required = event !== 'UPHOLD';
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={spec.title}
      description={spec.description}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(event, text.trim());
        }}
      >
        {spec.presets.length > 0 ? (
          <Field>
            <Label htmlFor="note-preset">Reason</Label>
            <NativeSelect
              id="note-preset"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            >
              <option value="">Choose a reason</option>
              {[...spec.presets, 'Other'].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <Field>
          <Label htmlFor="note-text">{spec.presets.length > 0 ? 'Anything to add' : 'Note'}</Label>
          <Textarea
            id="note-text"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <FieldHint>No client names or account details.</FieldHint>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || (required && text.trim().length < 3)}
          >
            {pending ? 'Saving…' : spec.label}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};
