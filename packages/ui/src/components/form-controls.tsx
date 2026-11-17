import { Label as L } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

const field =
  'w-full rounded-control border border-line-strong bg-surface text-body text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-120 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60 aria-invalid:border-danger';

export const Input = ({ className, ...props }: React.ComponentProps<'input'>) => (
  <input className={cn(field, 'h-9 px-3', className)} {...props} />
);

export const Textarea = ({ className, ...props }: React.ComponentProps<'textarea'>) => (
  <textarea
    className={cn(field, 'field-sizing-content min-h-24 px-3 py-2', className)}
    {...props}
  />
);

export const Label = ({ className, ...props }: React.ComponentProps<typeof L.Root>) => (
  <L.Root className={cn('text-ui font-medium text-ink', className)} {...props} />
);

export const FieldHint = ({ className, ...props }: React.ComponentProps<'p'>) => (
  <p className={cn('text-meta text-ink-3', className)} {...props} />
);

export const Field = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('grid gap-1.5', className)} {...props} />
);

export const NativeSelect = ({ className, ...props }: React.ComponentProps<'select'>) => (
  <select className={cn(field, 'h-9 cursor-pointer px-2.5', className)} {...props} />
);
