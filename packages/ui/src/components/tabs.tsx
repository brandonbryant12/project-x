import { Tabs as T } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export const Tabs = T.Root;

export const TabsList = ({ className, ...props }: React.ComponentProps<typeof T.List>) => (
  <T.List
    className={cn('inline-flex items-center gap-1 border-b border-line', className)}
    {...props}
  />
);

export const TabsTrigger = ({ className, ...props }: React.ComponentProps<typeof T.Trigger>) => (
  <T.Trigger
    className={cn(
      '-mb-px inline-flex h-10 cursor-pointer items-center gap-2 border-b-2 border-transparent px-3 text-ui font-medium text-ink-3 transition-[color,border-color] duration-150 ease-standard hover:text-ink data-[state=active]:border-primary data-[state=active]:text-ink',
      className,
    )}
    {...props}
  />
);

export const TabsContent = ({ className, ...props }: React.ComponentProps<typeof T.Content>) => (
  <T.Content
    className={cn('pt-5 outline-none data-[state=active]:animate-page-enter', className)}
    {...props}
  />
);
