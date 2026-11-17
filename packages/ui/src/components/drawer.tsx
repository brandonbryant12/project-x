import type * as React from 'react';
import { Drawer as V } from 'vaul';
import { cn } from '../lib/cn.ts';

export const Drawer = V.Root;
export const DrawerTrigger = V.Trigger;
export const DrawerClose = V.Close;
export const DrawerTitle = ({ className, ...props }: React.ComponentProps<typeof V.Title>) => (
  <V.Title className={cn('font-serif text-h1 font-medium', className)} {...props} />
);
export const DrawerDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof V.Description>) => (
  <V.Description className={cn('text-body text-ink-2', className)} {...props} />
);

export const DrawerContent = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof V.Content>) => (
  <V.Portal>
    <V.Overlay className="fixed inset-0 z-50 bg-ink/25 dark:bg-black/50" />
    <V.Content
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-dialog border-t border-line bg-raised pb-[env(safe-area-inset-bottom)]',
        className,
      )}
      {...props}
    >
      <div aria-hidden className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-line-strong" />
      {children}
    </V.Content>
  </V.Portal>
);
