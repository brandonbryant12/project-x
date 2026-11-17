import { Command as C } from 'cmdk';
import { SearchIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export const Command = ({ className, ...props }: React.ComponentProps<typeof C>) => (
  <C className={cn('flex h-full w-full flex-col overflow-hidden text-ink', className)} {...props} />
);

export const CommandInput = ({ className, ...props }: React.ComponentProps<typeof C.Input>) => (
  <div className="flex items-center gap-2 border-b border-line px-3">
    <SearchIcon className="size-4 shrink-0 text-ink-3" />
    <C.Input
      className={cn(
        'flex h-11 w-full bg-transparent text-body outline-none placeholder:text-ink-3',
        className,
      )}
      {...props}
    />
  </div>
);

export const CommandList = ({ className, ...props }: React.ComponentProps<typeof C.List>) => (
  <C.List className={cn('max-h-80 overflow-y-auto p-1', className)} {...props} />
);

export const CommandEmpty = (props: React.ComponentProps<typeof C.Empty>) => (
  <C.Empty className="py-6 text-center text-ui text-ink-3" {...props} />
);

export const CommandGroup = ({ className, ...props }: React.ComponentProps<typeof C.Group>) => (
  <C.Group
    className={cn(
      '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:text-ink-3',
      className,
    )}
    {...props}
  />
);

export const CommandItem = ({ className, ...props }: React.ComponentProps<typeof C.Item>) => (
  <C.Item
    className={cn(
      'flex h-9 cursor-pointer items-center gap-2 rounded-[5px] px-2 text-ui text-ink outline-none select-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-sunken [&_svg]:size-4 [&_svg]:text-ink-3',
      className,
    )}
    {...props}
  />
);

export const CommandSeparator = (props: React.ComponentProps<typeof C.Separator>) => (
  <C.Separator className="-mx-1 my-1 h-px bg-line" {...props} />
);
