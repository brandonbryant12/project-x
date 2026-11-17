import type { CatalogItemEventType, ChangeView } from '@repo/api';
import type { CatalogItemStatus } from '@repo/domain';
import {
  Button,
  Field,
  FieldHint,
  Label,
  PersonChip,
  SectionLabel,
  StatusPill,
  Textarea,
  type Tone,
} from '@repo/ui';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { describeError } from '@/lib/api.ts';
import { formatDate } from '@/lib/format.ts';

/** Status words and tones for catalog items (skills and activity templates). */
export const CATALOG_STATUS: Record<CatalogItemStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'success' },
  retired: { label: 'Retired', tone: 'muted' },
  discarded: { label: 'Discarded', tone: 'muted' },
};

export const CatalogStatusPill = ({ status }: { readonly status: CatalogItemStatus }) => (
  <StatusPill {...CATALOG_STATUS[status]} />
);

/** Button labels for catalog lifecycle events. */
const CATALOG_EVENT_LABEL: Record<CatalogItemEventType, string> = {
  PUBLISH: 'Publish',
  RETIRE: 'Retire',
  DISCARD: 'Discard draft',
};

export type ChangeValue = ChangeView['changes'][number]['before'];

const show = (value: ChangeValue, format?: (v: ChangeValue) => string) => {
  if (value === null || value === '') return 'not set';
  if (format) return format(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
};

/**
 * The audited changes to one thing, newest first: who, when, why, and each
 * field before and after. `label` and `format` turn field names and values
 * into the words the form uses.
 */
export const ChangeHistory = ({
  history,
  label = (field) => field,
  format,
  empty,
}: {
  readonly history: ReadonlyArray<ChangeView>;
  readonly label?: (field: string) => string;
  readonly format?: (field: string, value: ChangeValue) => string;
  readonly empty: string;
}) => (
  <section className="grid gap-3" aria-labelledby="changes">
    <SectionLabel id="changes">Recent changes</SectionLabel>
    {history.length === 0 ? (
      <p className="text-ui text-ink-3">{empty}</p>
    ) : (
      <ol className="grid gap-5">
        {history.map((h) => (
          <li key={h.id} className="grid gap-2 border-l-2 border-line pl-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {h.actor ? (
                <PersonChip person={h.actor} subtitle={formatDate(h.at, { year: 'numeric' })} />
              ) : (
                <span className="text-meta text-ink-3">
                  {formatDate(h.at, { year: 'numeric' })}
                </span>
              )}
            </div>
            {h.reason ? <p className="text-ui text-ink-2">“{h.reason}”</p> : null}
            {h.changes.length > 0 ? (
              <ul className="grid gap-1">
                {h.changes.map((c) => (
                  <li key={c.field} className="text-meta text-ink-3">
                    <span className="text-ink-2">{label(c.field)}</span>:{' '}
                    {show(c.before, format && ((v) => format(c.field, v)))} →{' '}
                    <span className="text-ink-2">
                      {show(c.after, format && ((v) => format(c.field, v)))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    )}
  </section>
);

/**
 * A confirmation that restates what will happen before a publish, retire or
 * discard, with an optional note for the record.
 */
const ConfirmTransition = ({
  open,
  onClose,
  title,
  description,
  consequences,
  confirmLabel,
  noteLabel,
  pending,
  error,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description: string;
  readonly consequences: ReadonlyArray<string>;
  readonly confirmLabel: string;
  readonly noteLabel: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onConfirm: (note: string | null) => void;
}) => {
  const [note, setNote] = useState('');
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(note.trim() === '' ? null : note.trim());
        }}
      >
        {consequences.length > 0 ? (
          <ul className="grid list-disc gap-1.5 pl-5 text-ui text-ink-2">
            {consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
        <Field>
          <Label htmlFor="transition-note">{noteLabel}</Label>
          <Textarea
            id="transition-note"
            value={note}
            maxLength={600}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-20"
          />
          <FieldHint>Optional. Kept with the change in the record.</FieldHint>
        </Field>
        {error ? (
          <p role="alert" className="text-ui text-danger-ink">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Go back
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

/** What a confirmation says before a catalog event. */
export interface TransitionCopy {
  readonly title: string;
  readonly description: string;
  readonly consequences: ReadonlyArray<string>;
  readonly confirm: string;
  readonly note: string;
}

/**
 * The lifecycle buttons a view allows (rule 2: only from its `actions`), each
 * opening a confirmation that restates what happens. `submit` sends the event;
 * a refusal is shown in the dialog.
 */
export const CatalogActions = ({
  actions,
  copyFor,
  unsaved,
  submit,
}: {
  readonly actions: ReadonlyArray<CatalogItemEventType>;
  readonly copyFor: (event: CatalogItemEventType) => TransitionCopy;
  /** The editor holds changes that are not saved: publishing uses what was last saved. */
  readonly unsaved: boolean;
  readonly submit: (event: CatalogItemEventType, note: string | null) => Promise<unknown>;
}) => {
  const [event, setEvent] = useState<CatalogItemEventType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = event ? copyFor(event) : null;
  return (
    <>
      {actions.map((a) => (
        <Button
          key={a}
          variant={a === 'PUBLISH' ? 'primary' : 'secondary'}
          onClick={() => {
            setError(null);
            setEvent(a);
          }}
        >
          {CATALOG_EVENT_LABEL[a]}
        </Button>
      ))}
      {copy && event ? (
        <ConfirmTransition
          open
          onClose={() => setEvent(null)}
          title={copy.title}
          description={
            unsaved && event === 'PUBLISH'
              ? `${copy.description} You have unsaved changes: publishing uses what was last saved.`
              : copy.description
          }
          consequences={copy.consequences}
          confirmLabel={copy.confirm}
          noteLabel={copy.note}
          pending={busy}
          error={error}
          onConfirm={(note) => {
            setBusy(true);
            setError(null);
            submit(event, note)
              .then(
                () => setEvent(null),
                (e: unknown) => setError(describeError(e)),
              )
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </>
  );
};

/** A whole number from an input, or null when the input is empty. */
export const parseWhole = (text: string): number | null => {
  const t = text.trim();
  return t === '' ? null : Number(t);
};
