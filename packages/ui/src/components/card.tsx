import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export const Card = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('rounded-card border border-line bg-surface shadow-card', className)}
    {...props}
  />
);

export const CardHeader = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)} {...props} />
);

export const CardTitle = ({ className, ...props }: React.ComponentProps<'h3'>) => (
  <h3 className={cn('text-h2 font-semibold text-ink', className)} {...props} />
);

export const CardDescription = ({ className, ...props }: React.ComponentProps<'p'>) => (
  <p className={cn('text-ui text-ink-2', className)} {...props} />
);

export const CardContent = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('px-5 py-5', className)} {...props} />
);

export const CardFooter = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('flex items-center justify-end gap-2 border-t border-line px-5 py-3', className)}
    {...props}
  />
);

/** Editorial folio section label with quiet hairline cadence. */
export const SectionLabel = ({ className, ...props }: React.ComponentProps<'h2'>) => (
  <h2
    className={cn(
      'font-mono text-[11px] font-medium tracking-[0.09em] text-ink-3 uppercase',
      className,
    )}
    {...props}
  />
);
