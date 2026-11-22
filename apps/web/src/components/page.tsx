import { cn } from '@repo/ui';

/** Page frame: 16/24/32 gutters, 1200px cap (ux-brief §6). */
export const Page = ({
  children,
  className,
  width = 'wide',
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly width?: 'wide' | 'reading';
}) => (
  <div
    className={cn(
      'mx-auto w-full animate-page-enter px-4 py-6 md:px-6 md:py-8 xl:px-8',
      width === 'wide' ? 'max-w-[1200px]' : 'max-w-[760px]',
      className,
    )}
  >
    {children}
  </div>
);

export const PageHeader = ({
  title,
  description,
  actions,
  eyebrow,
}: {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly eyebrow?: React.ReactNode;
}) => (
  <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div className="grid gap-1.5">
      {eyebrow ? <div className="text-meta text-ink-3">{eyebrow}</div> : null}
      <h1 className="font-serif text-h1 font-medium text-ink md:text-display">{title}</h1>
      {description ? <p className="max-w-2xl text-body text-ink-2">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </header>
);

export const SkillChip = ({
  name,
  className,
  suggested = false,
}: {
  readonly name: string;
  readonly className?: string;
  readonly suggested?: boolean;
}) => (
  <span
    className={cn(
      'inline-flex h-6 items-center rounded-full border px-2.5 text-meta font-medium whitespace-nowrap',
      suggested
        ? 'border-dashed border-info/60 text-info-ink'
        : 'border-line bg-surface text-ink-2',
      className,
    )}
  >
    {name}
  </span>
);
