import { XIcon } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export const DialogOverlay = ({ className, ...props }: React.ComponentProps<typeof D.Overlay>) => (
  <D.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-ink/25 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/50',
      className,
    )}
    {...props}
  />
);

export const DialogContent = ({
  className,
  children,
  hideClose = false,
  ...props
}: React.ComponentProps<typeof D.Content> & { readonly hideClose?: boolean }) => (
  <D.Portal>
    <DialogOverlay />
    <D.Content
      className={cn(
        'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-dialog border border-line bg-raised p-6 shadow-overlay duration-260 ease-standard data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]',
        className,
      )}
      {...props}
    >
      {children}
      {hideClose ? null : (
        <D.Close className="absolute top-4 right-4 rounded-control p-1 text-ink-3 transition-colors hover:bg-sunken hover:text-ink">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </D.Close>
      )}
    </D.Content>
  </D.Portal>
);

export const DialogHeader = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
    {...props}
  />
);

export const DialogTitle = ({ className, ...props }: React.ComponentProps<typeof D.Title>) => (
  <D.Title className={cn('font-serif text-h1 font-medium text-ink', className)} {...props} />
);

export const DialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof D.Description>) => (
  <D.Description className={cn('text-body text-ink-2', className)} {...props} />
);

/** Side sheet built on Dialog (Receipts, details). */
export const SheetContent = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof D.Content>) => (
  <D.Portal>
    <DialogOverlay />
    <D.Content
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-raised shadow-overlay duration-260 ease-standard data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
        className,
      )}
      {...props}
    >
      {children}
      <D.Close className="absolute top-4 right-4 rounded-control p-1 text-ink-3 transition-colors hover:bg-sunken hover:text-ink">
        <XIcon className="size-4" />
        <span className="sr-only">Close</span>
      </D.Close>
    </D.Content>
  </D.Portal>
);
