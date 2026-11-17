import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export const pillVariants = cva(
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-meta font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-sunken text-ink-2',
        muted: 'bg-sunken text-ink-3',
        info: 'bg-info-soft text-info-ink',
        warning: 'bg-warning-soft text-warning-ink',
        success: 'bg-success-soft text-success-ink',
        primary: 'bg-primary-soft text-primary-ink',
        brass: 'bg-brass-soft text-brass-ink',
        outline: 'border border-line bg-surface text-ink-2',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const dotTone: Record<NonNullable<PillProps['tone']>, string> = {
  neutral: 'bg-ink-3',
  muted: 'bg-ink-3/60',
  info: 'bg-info',
  warning: 'bg-warning',
  success: 'bg-success',
  primary: 'bg-primary',
  brass: 'bg-brass',
  outline: 'bg-ink-3',
};

export interface PillProps extends React.ComponentProps<'span'>, VariantProps<typeof pillVariants> {
  readonly dot?: boolean;
}

export const Pill = ({ className, tone, dot = false, children, ...props }: PillProps) => (
  <span className={cn(pillVariants({ tone }), className)} {...props}>
    {dot ? (
      <span aria-hidden className={cn('size-1.5 rounded-full', dotTone[tone ?? 'neutral'])} />
    ) : null}
    {children}
  </span>
);
