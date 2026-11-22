import type * as React from 'react';
import { cn } from '../lib/cn.ts';

/**
 * CatalystArc — minimal brass arc cue used sparingly on real coaching moments
 * ("Try next time", editorial captions) echoing the logo's brass closing arc.
 */
export const CatalystArc = ({
  size = 14,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}) => (
  <svg
    aria-hidden
    viewBox="0 0 16 16"
    width={size}
    height={size}
    fill="none"
    className={cn('shrink-0 text-brass', className)}
  >
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.6" />
    <path
      d="M 8 2.5 A 5.5 5.5 0 0 1 13.5 8"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  </svg>
);

const MARK_PX = { xs: 18, sm: 23, md: 28, lg: 36 } as const;

/**
 * CatalystMark — the Closing Mastery Ring:
 * an open `C` arc in pine ink (coaching craft) closing toward completion with
 * a single warm brass arc (the catalyst observation that unlocks mastery).
 * Every skill ring in the app shares this exact geometry.
 */
export const CatalystMark = ({
  size = 'sm',
  tone = 'brand',
  className,
  label,
}: {
  readonly size?: keyof typeof MARK_PX;
  readonly tone?: 'brand' | 'mono';
  readonly className?: string;
  readonly label?: string;
}) => {
  const px = MARK_PX[size];
  const strokePrimary = tone === 'brand' ? 'var(--color-primary)' : 'currentColor';
  const strokeBrass = tone === 'brand' ? 'var(--color-brass)' : 'currentColor';
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0', className)}
    >
      {/* Open C mastery ring in pine ink */}
      <path
        d="M 16.8 5.4 A 8 8 0 1 0 19.6 14.4"
        stroke={strokePrimary}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* Brass catalyst closing arc — glides subtly closer on brand hover */}
      <path
        d="M 19.3 8.5 A 8 8 0 0 1 20 11.4"
        stroke={strokeBrass}
        strokeWidth="2.4"
        strokeLinecap="round"
        className="origin-center transition-transform duration-300 ease-settle group-hover/brand:rotate-[10deg]"
      />
    </svg>
  );
};

const LOCKUP_SIZES = {
  sm: {
    mark: 'sm' as const,
    gap: 'gap-2',
    coaching: 'text-[15.5px]',
    catalyst: 'text-[18px]',
  },
  md: {
    mark: 'md' as const,
    gap: 'gap-2.5',
    coaching: 'text-[18px]',
    catalyst: 'text-[21px]',
  },
  lg: {
    mark: 'lg' as const,
    gap: 'gap-3',
    coaching: 'text-[21px]',
    catalyst: 'text-[24.5px]',
  },
} as const;

/**
 * BrandLockup — compact Closing Mastery Ring + `Coaching` (Geist semibold)
 * paired with `Catalyst` (optical Newsreader italic in pine ink).
 */
export const BrandLockup = ({
  size = 'sm',
  tagline,
  className,
}: {
  readonly size?: keyof typeof LOCKUP_SIZES;
  readonly tagline?: string;
  readonly className?: string;
}) => {
  const s = LOCKUP_SIZES[size];
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap', s.gap, className)}>
      <CatalystMark size={s.mark} />
      <span className="inline-flex flex-col leading-none">
        <span className="inline-flex items-baseline gap-[0.24em]">
          <span className={cn('font-sans font-semibold tracking-[-0.025em] text-ink', s.coaching)}>
            Coaching
          </span>
          <span
            className={cn(
              'font-serif font-normal tracking-[-0.01em] text-primary-ink italic',
              s.catalyst,
            )}
            style={{ fontOpticalSizing: 'auto' } as React.CSSProperties}
          >
            Catalyst
          </span>
        </span>
        {tagline ? (
          <span className="mt-1 font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
};
