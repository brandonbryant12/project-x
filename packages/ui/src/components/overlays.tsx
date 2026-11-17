import { DropdownMenu as M, HoverCard as H, Popover as P, Tooltip as T } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

const floating =
  'z-50 rounded-card border border-line bg-raised text-ink shadow-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1';

export const TooltipProvider = T.Provider;
export const Tooltip = T.Root;
export const TooltipTrigger = T.Trigger;
export const TooltipContent = ({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof T.Content>) => (
  <T.Portal>
    <T.Content
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-72 rounded-control bg-ink px-2.5 py-1.5 text-meta text-canvas data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0',
        className,
      )}
      {...props}
    />
  </T.Portal>
);

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverContent = ({
  className,
  sideOffset = 6,
  align = 'start',
  ...props
}: React.ComponentProps<typeof P.Content>) => (
  <P.Portal>
    <P.Content
      sideOffset={sideOffset}
      align={align}
      className={cn(floating, 'w-72 p-3 outline-none', className)}
      {...props}
    />
  </P.Portal>
);

export const HoverCard = H.Root;
export const HoverCardTrigger = H.Trigger;
export const HoverCardContent = ({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof H.Content>) => (
  <H.Portal>
    <H.Content sideOffset={sideOffset} className={cn(floating, 'w-72 p-4', className)} {...props} />
  </H.Portal>
);

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuContent = ({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: React.ComponentProps<typeof M.Content>) => (
  <M.Portal>
    <M.Content
      sideOffset={sideOffset}
      align={align}
      className={cn(floating, 'min-w-44 p-1', className)}
      {...props}
    />
  </M.Portal>
);
export const DropdownMenuItem = ({ className, ...props }: React.ComponentProps<typeof M.Item>) => (
  <M.Item
    className={cn(
      'flex h-8 cursor-pointer items-center gap-2 rounded-[5px] px-2 text-ui text-ink outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-sunken [&_svg]:size-4 [&_svg]:text-ink-3',
      className,
    )}
    {...props}
  />
);
export const DropdownMenuSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof M.Separator>) => (
  <M.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />
);
export const DropdownMenuLabel = ({
  className,
  ...props
}: React.ComponentProps<typeof M.Label>) => (
  <M.Label className={cn('px-2 py-1.5 text-meta text-ink-3', className)} {...props} />
);
