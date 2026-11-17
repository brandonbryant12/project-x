import { ChevronDownIcon, ScanSearchIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn.ts';

/**
 * Assistant surfaces (ADR 0008): dashed, info-tinted, always hedged, never the
 * primary color, never a button that fills in the form.
 */
export const AssistantNote = ({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) => (
  <div
    role="status"
    className={cn(
      'flex gap-2.5 rounded-control border border-dashed border-info/50 bg-info-soft/60 px-3 py-2.5 text-ui text-info-ink',
      className,
    )}
  >
    <ScanSearchIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
    <div>{children}</div>
  </div>
);

export interface PreReadFinding {
  readonly key: string;
  readonly label: string;
  readonly outcome: 'yes' | 'no' | 'unclear';
}

const OUTCOME_DOT = { yes: 'bg-success', no: 'bg-ink-3', unclear: 'bg-warning' } as const;

export const AssistantPreRead = ({
  findings,
  state,
  defaultOpen = true,
  className,
}: {
  readonly findings: ReadonlyArray<PreReadFinding>;
  readonly state: 'ready' | 'pending' | 'unavailable';
  readonly defaultOpen?: boolean;
  readonly className?: string;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      aria-live="polite"
      className={cn('rounded-card border border-dashed border-info/50 bg-info-soft/40', className)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left"
      >
        <ScanSearchIcon aria-hidden className="size-4 text-info-ink" />
        <span className="flex-1">
          <span className="block text-ui font-medium text-info-ink">Automated privacy check</span>
          <span className="block text-meta text-ink-3">An automated check. You decide.</span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            'size-4 text-ink-3 transition-transform duration-180',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-dashed border-info/40 px-4 py-3">
          {state === 'pending' ? <p className="text-ui text-ink-3">Reading the evidence…</p> : null}
          {state === 'unavailable' ? (
            <p className="text-ui text-ink-3">
              Assistant check unavailable. Nothing depends on it.
            </p>
          ) : null}
          {state === 'ready' ? (
            <ul className="grid gap-2">
              {findings.map((f) => (
                <li key={f.key} className="flex items-start gap-2 text-ui text-ink-2">
                  <span
                    aria-hidden
                    className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', OUTCOME_DOT[f.outcome])}
                  />
                  {f.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
