import { CheckIcon } from 'lucide-react';
import { Checkbox as C } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export const Checkbox = ({ className, ...props }: React.ComponentProps<typeof C.Root>) => (
  <C.Root
    className={cn(
      'peer inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-line-strong bg-surface transition-colors duration-120 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg',
      className,
    )}
    {...props}
  >
    <C.Indicator>
      <CheckIcon className="size-3.5" strokeWidth={3} />
    </C.Indicator>
  </C.Root>
);
