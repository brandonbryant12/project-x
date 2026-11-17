import type { DesignationView, PersonSummary } from '@repo/api';
import { MAX_DESIGNATION_DAYS, type IsoDate, type PersonId } from '@repo/domain';
import {
  Button,
  cn,
  Field,
  FieldHint,
  Input,
  Label,
  PersonAvatar,
  SectionLabel,
  Skeleton,
  StatusPill,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { describeError, queryOptions, useApiMutation } from '@/lib/api.ts';
import { formatDate, todayIso } from '@/lib/format.ts';
import { useSession } from '@/lib/session.ts';

const daysFromToday = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const firstName = (p: PersonSummary) => p.displayName.split(' ')[0] ?? p.displayName;

/** Pick a colleague by name. Directory search; the server decides who is allowed. */
const ColleaguePicker = ({
  exclude,
  value,
  onChange,
}: {
  readonly exclude: ReadonlyArray<string>;
  readonly value: PersonId | null;
  readonly onChange: (id: PersonId) => void;
}) => {
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const results = useQuery({
    ...queryOptions('people', 'search', { query: { q: query } }),
    enabled: query.length >= 2,
  });
  const people = (results.data ?? []).filter((c) => !exclude.includes(c.person.id)).slice(0, 6);
  return (
    <Field>
      <Label htmlFor="designate-search">Colleague</Label>
      <Input
        id="designate-search"
        type="search"
        autoComplete="off"
        placeholder="Type a name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.isFetching && people.length === 0 ? <Skeleton className="h-12" /> : null}
      {people.length > 0 ? (
        <div role="radiogroup" aria-label="Colleague" className="grid gap-1">
          {people.map((c) => (
            <label
              key={c.person.id}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-control border px-3 py-2 transition-colors',
                value === c.person.id
                  ? 'border-primary bg-primary-soft/40'
                  : 'border-line hover:bg-sunken',
              )}
            >
              <input
                type="radio"
                name="designate-observer"
                className="sr-only"
                checked={value === c.person.id}
                onChange={() => onChange(c.person.id)}
              />
              <PersonAvatar person={c.person} size="sm" />
              <span className="grid min-w-0">
                <span className="truncate text-ui font-medium text-ink">
                  {c.person.displayName}
                </span>
                <span className="truncate text-meta text-ink-3">
                  {[c.person.title, c.location].filter(Boolean).join(' · ')}
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {query.length >= 2 && results.isSuccess && people.length === 0 ? (
        <FieldHint>Nobody matches “{query}”.</FieldHint>
      ) : null}
    </Field>
  );
};

const DesignateDialog = ({
  subject,
  exclude,
  open,
  onClose,
}: {
  readonly subject: PersonSummary;
  readonly exclude: ReadonlyArray<string>;
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const [observerId, setObserverId] = useState<PersonId | null>(null);
  const [validTo, setValidTo] = useState(daysFromToday(30));
  const [error, setError] = useState<string | null>(null);
  const designate = useApiMutation('hub', 'designate', {
    invalidates: ['hub', 'people'],
    onSuccess: (d) => {
      toast.success(
        `${d.observer.displayName} can observe ${firstName(subject)} until ${formatDate(d.validTo)}.`,
      );
      onClose();
    },
    onError: (e) => setError(describeError(e)),
  });
  const max = daysFromToday(MAX_DESIGNATION_DAYS);
  const windowOk = validTo > todayIso() && validTo <= max;
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Name an observer for ${firstName(subject)}`}
      description={`A colleague who sees ${firstName(subject)}’s work can observe and sign, from today for up to ${MAX_DESIGNATION_DAYS} days. ${firstName(subject)} sees who it is.`}
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!observerId || !windowOk) return;
          setError(null);
          designate.mutate({
            payload: {
              subjectId: subject.id,
              observerId,
              validFrom: todayIso() as IsoDate,
              validTo: validTo as IsoDate,
            },
          });
        }}
      >
        <ColleaguePicker exclude={exclude} value={observerId} onChange={setObserverId} />
        <Field>
          <Label htmlFor="designate-until">Until</Label>
          <Input
            id="designate-until"
            type="date"
            min={daysFromToday(1)}
            max={max}
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
            className="w-auto"
          />
          <FieldHint>At most {MAX_DESIGNATION_DAYS} days. You can end it sooner.</FieldHint>
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
          <Button
            type="submit"
            variant="primary"
            disabled={!observerId || !windowOk || designate.isPending}
          >
            {designate.isPending ? 'Saving…' : 'Name observer'}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

const DesignationRow = ({ d }: { readonly d: DesignationView }) => {
  const me = useSession().person.id;
  const end = useApiMutation('hub', 'endDesignation', {
    invalidates: ['hub', 'people'],
    onSuccess: () => toast.success(`Ended. ${d.observer.displayName} can no longer observe.`),
  });
  const by = d.designatedBy.id === me ? 'you' : d.designatedBy.displayName;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <PersonAvatar person={d.observer} size="sm" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-ui text-ink">{d.observer.displayName}</p>
        <p className="text-meta text-ink-3">
          Named by {by} · {formatDate(d.validFrom)} to {formatDate(d.validTo)}
        </p>
      </div>
      {d.active ? null : <StatusPill label="Ended" tone="muted" />}
      {d.active && d.canEnd ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={end.isPending}
          onClick={() => end.mutate({ params: { id: d.id } })}
        >
          End now
        </Button>
      ) : null}
    </li>
  );
};

/**
 * Designated observers on a person's page (ADR 0020), for their leader or an
 * engaged coach: name a colleague who sees their work, list, and end.
 */
export const DesignationsSection = ({
  subject,
  canDesignate,
}: {
  readonly subject: PersonSummary;
  readonly canDesignate: boolean;
}) => {
  const me = useSession().person.id;
  const [open, setOpen] = useState(false);
  const list = useQuery(queryOptions('hub', 'designations', { params: { id: subject.id } }));
  const rows = list.data ?? [];
  if (!canDesignate && rows.length === 0) return null;
  const active = rows.filter((d) => d.active);
  const past = rows.filter((d) => !d.active).slice(0, 5);
  return (
    <section className="mt-12 grid gap-3" aria-labelledby="designations">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel id="designations">Named observers</SectionLabel>
        {canDesignate ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <PlusIcon /> Name an observer
          </Button>
        ) : null}
      </div>
      <p className="max-w-[60ch] text-ui text-ink-2">
        A colleague who works alongside {firstName(subject)} can observe and sign while they are
        named here, for up to {MAX_DESIGNATION_DAYS} days.
      </p>
      {rows.length > 0 ? (
        <ul className="divide-y divide-line border-y border-line">
          {[...active, ...past].map((d) => (
            <DesignationRow key={d.id} d={d} />
          ))}
        </ul>
      ) : (
        <p className="text-ui text-ink-3">Nobody is named.</p>
      )}
      {canDesignate ? (
        <DesignateDialog
          key={open ? 'open' : 'closed'}
          subject={subject}
          exclude={[subject.id, me, ...active.map((d) => d.observer.id)]}
          open={open}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
};
