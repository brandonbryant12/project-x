import { Collapsible as Co, ScrollArea as S, Separator as Se } from 'radix-ui';
import type * as React from 'react';
import { Toaster as Sonner } from 'sonner';
import { cn } from '../lib/cn.ts';

export const Collapsible = Co.Root;
export const CollapsibleTrigger = Co.Trigger;
export const CollapsibleContent = ({
  className,
  ...props
}: React.ComponentProps<typeof Co.Content>) => (
  <Co.Content
    className={cn(
      'overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down',
      className,
    )}
    {...props}
  />
);

export const Skeleton = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('animate-pulse rounded-control bg-sunken', className)} {...props} />
);

export const Separator = ({ className, ...props }: React.ComponentProps<typeof Se.Root>) => (
  <Se.Root
    className={cn(
      'shrink-0 bg-line data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
      className,
    )}
    {...props}
  />
);

export const ScrollArea = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof S.Root>) => (
  <S.Root className={cn('relative overflow-hidden', className)} {...props}>
    <S.Viewport className="size-full rounded-[inherit]">{children}</S.Viewport>
    <S.Scrollbar
      orientation="vertical"
      className="flex w-2 touch-none p-px transition-colors select-none"
    >
      <S.Thumb className="relative flex-1 rounded-full bg-line-strong" />
    </S.Scrollbar>
  </S.Root>
);

export const Kbd = ({ className, ...props }: React.ComponentProps<'kbd'>) => (
  <kbd
    className={cn(
      'inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-sunken px-1 font-mono text-[11px] text-ink-3',
      className,
    )}
    {...props}
  />
);

export const Toaster = (props: React.ComponentProps<typeof Sonner>) => (
  <Sonner
    position="bottom-right"
    toastOptions={{
      classNames: {
        toast:
          'group !rounded-card !border !border-line !bg-raised !text-ink !shadow-overlay !font-sans !text-ui',
        description: '!text-ink-2',
        actionButton: '!bg-primary !text-primary-fg',
        cancelButton: '!bg-sunken !text-ink-2',
      },
    }}
    {...props}
  />
);
export { toast } from 'sonner';
