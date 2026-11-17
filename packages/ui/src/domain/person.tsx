import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export interface PersonLike {
  readonly displayName: string;
  readonly initials: string;
  readonly hue: number;
  readonly title?: string | null;
}

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-meta',
  md: 'size-10 text-ui',
  lg: 'size-[72px] text-h2',
};

export const PersonAvatar = ({
  person,
  size = 'sm',
  className,
}: {
  readonly person: PersonLike;
  readonly size?: keyof typeof SIZES;
  readonly className?: string;
}) => (
  <span
    aria-hidden
    className={cn(
      'cc-hue inline-flex shrink-0 items-center justify-center rounded-full bg-(--hue-tint) font-semibold text-(--hue-ink) select-none',
      SIZES[size],
      className,
    )}
    style={{ '--hue': person.hue } as React.CSSProperties}
  >
    {person.initials}
  </span>
);

export const PersonChip = ({
  person,
  subtitle,
  size = 'sm',
  className,
}: {
  readonly person: PersonLike;
  readonly subtitle?: React.ReactNode;
  readonly size?: 'xs' | 'sm' | 'md';
  readonly className?: string;
}) => (
  <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
    <PersonAvatar person={person} size={size} />
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-ui font-medium text-ink">{person.displayName}</span>
      {(subtitle ?? person.title) ? (
        <span className="truncate text-meta text-ink-3">{subtitle ?? person.title}</span>
      ) : null}
    </span>
  </span>
);
