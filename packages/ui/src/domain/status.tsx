import { CircleCheckIcon, CircleIcon } from 'lucide-react';
import { Pill, type PillProps } from '../components/pill.tsx';
import { cn } from '../lib/cn.ts';

export type Tone = NonNullable<PillProps['tone']>;

export const StatusPill = ({
  label,
  tone,
  className,
}: {
  readonly label: string;
  readonly tone: Tone;
  readonly className?: string;
}) => (
  <Pill tone={tone} dot className={className}>
    {label}
  </Pill>
);

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Dates, not countdowns (ux-brief §3 "Expiry without anxiety"). Warning tone
 * only within three days. Never red.
 */
export const describeDue = (dueAt: string, now = new Date()) => {
  const due = new Date(dueAt);
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  const date = due.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  if (days < 0) return { text: `Closed ${date}`, soon: false, closed: true };
  if (days === 0) return { text: 'Closes today', soon: true, closed: false };
  if (days <= 3) {
    const weekday = due.toLocaleDateString(undefined, { weekday: 'long' });
    return { text: `Closes ${days === 1 ? 'tomorrow' : weekday}`, soon: true, closed: false };
  }
  return { text: `Open until ${date}`, soon: false, closed: false };
};

export const DueLabel = ({
  dueAt,
  className,
}: {
  readonly dueAt: string;
  readonly className?: string;
}) => {
  const due = describeDue(dueAt);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-meta text-ink-3 tabular', className)}
      title={new Date(dueAt).toLocaleString()}
    >
      {due.soon ? <span aria-hidden className="size-1.5 rounded-full bg-warning" /> : null}
      {due.text}
    </span>
  );
};

export interface ChecklistItem {
  readonly key: string;
  readonly label: string;
  readonly met: boolean;
}

export const CriteriaChecklist = ({
  criteria,
  nextStep,
  className,
}: {
  readonly criteria: ReadonlyArray<ChecklistItem>;
  readonly nextStep?: string;
  readonly className?: string;
}) => (
  <div className={cn('grid gap-3', className)}>
    <ul className="grid gap-1.5">
      {criteria.map((c) => (
        <li key={c.key} className="flex items-center gap-2 text-ui">
          {c.met ? (
            <CircleCheckIcon aria-hidden className="size-4 text-success" />
          ) : (
            <CircleIcon aria-hidden className="size-4 text-line-strong" />
          )}
          <span className={c.met ? 'text-ink' : 'text-ink-2'}>{c.label}</span>
          <span className="sr-only">{c.met ? '(met)' : '(not yet)'}</span>
        </li>
      ))}
    </ul>
    {nextStep ? <p className="text-ui text-ink-2">{nextStep}</p> : null}
  </div>
);

export const CoverageDots = ({
  dots,
}: {
  readonly dots: ReadonlyArray<{
    readonly key: string;
    readonly filled: boolean;
    readonly label: string;
  }>;
}) => (
  <span
    className="inline-flex items-center gap-1.5"
    role="img"
    aria-label={dots.map((d) => d.label).join('. ') || 'No focus skills'}
  >
    {dots.map((d) => (
      <span
        key={d.key}
        title={d.label}
        className={cn(
          'size-2.5 rounded-full border',
          d.filled ? 'border-primary bg-primary' : 'border-line-strong bg-transparent',
        )}
      />
    ))}
  </span>
);

export interface TimelineEntry {
  readonly key: string;
  readonly at: string;
  readonly title: string;
  readonly detail?: string | null;
}

export const LifecycleTimeline = ({ items }: { readonly items: ReadonlyArray<TimelineEntry> }) => (
  <ol className="relative grid gap-4 border-l border-line pl-5">
    {items.map((item) => (
      <li key={item.key} className="relative">
        <span
          aria-hidden
          className="absolute top-1.5 -left-[23.5px] size-2 rounded-full border border-line-strong bg-surface"
        />
        <p className="text-ui text-ink">{item.title}</p>
        <p className="text-meta text-ink-3">
          {new Date(item.at).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          {item.detail ? ` · ${item.detail}` : ''}
        </p>
      </li>
    ))}
  </ol>
);

export const EmptyState = ({
  title,
  children,
  action,
  className,
}: {
  readonly title?: string;
  readonly children: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly className?: string;
}) => (
  <div
    className={cn(
      'flex flex-col items-start gap-3 rounded-card border border-dashed border-line-strong px-6 py-8',
      className,
    )}
  >
    {title ? <p className="font-serif text-h2 text-ink">{title}</p> : null}
    <p className="max-w-prose text-body text-ink-2">{children}</p>
    {action ? <div className="mt-1 flex flex-wrap gap-2">{action}</div> : null}
  </div>
);
