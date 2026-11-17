import { ToggleGroup as T } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

/** Segmented control. */
export const SegmentedControl = ({ className, ...props }: React.ComponentProps<typeof T.Root>) => (
  <T.Root
    className={cn('inline-flex rounded-control border border-line bg-sunken p-0.5', className)}
    {...props}
  />
);

export const SegmentedItem = ({ className, ...props }: React.ComponentProps<typeof T.Item>) => (
  <T.Item
    className={cn(
      'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] px-3 text-ui font-medium text-ink-2 transition-colors duration-120 hover:text-ink data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-sm',
      className,
    )}
    {...props}
  />
);
