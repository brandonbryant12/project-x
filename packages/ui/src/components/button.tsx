import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-150 ease-standard select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg shadow-sm hover:bg-primary-hover active:scale-[0.985]',
        secondary:
          'border border-line-strong bg-surface text-ink shadow-sm hover:border-ink-3/50 hover:bg-sunken active:scale-[0.985]',
        ghost: 'text-ink-2 hover:bg-sunken hover:text-ink active:scale-[0.985]',
        soft: 'bg-primary-soft text-primary-ink hover:bg-primary-soft/75 active:scale-[0.985]',
        danger: 'bg-danger text-primary-fg hover:bg-danger/90 active:scale-[0.985]',
        link: 'h-auto px-0 text-primary-ink underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-ui',
        md: 'h-9 px-4 text-ui',
        lg: 'h-11 px-5 text-body',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean;
}

export const Button = ({ className, variant, size, asChild = false, ...props }: ButtonProps) => {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
};
