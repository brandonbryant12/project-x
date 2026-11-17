import type * as React from 'react';
import { cn } from '../lib/cn.ts';
import { domainStyle } from './skill-domain.ts';

/**
 * BadgeSeal — an embossed stamp, not a medal (ux-brief §4).
 * Level is encoded twice: outer arcs (1-4 filled) and fill treatment. Level 4
 * adds a brass ring. `level={0}` renders the "not yet earned" dashed outline.
 */
export interface BadgeSealProps {
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly domain: string;
  readonly size?: 24 | 40 | 56 | 64 | 96;
  readonly className?: string;
  readonly settle?: boolean;
  readonly label?: string;
}

const polar = (r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [32 + r * Math.cos(rad), 32 + r * Math.sin(rad)] as const;
};

const arc = (r: number, start: number, end: number) => {
  const [x1, y1] = polar(r, start);
  const [x2, y2] = polar(r, end);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

const SEGMENTS = [0, 1, 2, 3].map((i) => arc(28.5, i * 90 + 7, i * 90 + 83));

const DISC_FILL = [
  'transparent',
  'transparent',
  'var(--hue-tint)',
  'var(--hue-solid)',
  'var(--hue-solid)',
] as const;

export const BadgeSeal = ({
  level,
  domain,
  size = 56,
  className,
  settle = false,
  label,
}: BadgeSealProps) => {
  const { hue, icon: Glyph } = domainStyle(domain);
  const showGlyph = size > 24;
  const earned = level > 0;
  const discFill = DISC_FILL[level];
  const glyphColor = level >= 3 ? 'var(--hue-on-solid)' : 'var(--hue-ink)';
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'cc-hue relative inline-flex shrink-0',
        settle && 'animate-seal-settle',
        className,
      )}
      style={{ width: size, height: size, '--hue': hue } as React.CSSProperties}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none">
        {earned ? (
          <>
            {level === 4 ? (
              <circle cx="32" cy="32" r="31.25" stroke="var(--color-brass)" strokeWidth="1.5" />
            ) : null}
            {SEGMENTS.map((d, i) => (
              <path
                key={d}
                d={d}
                strokeWidth="3"
                strokeLinecap="round"
                stroke={i < level ? 'var(--hue-solid)' : 'var(--color-line-strong)'}
              />
            ))}
            <circle
              cx="32"
              cy="32"
              r="22"
              fill={discFill}
              stroke="var(--hue-solid)"
              strokeWidth={level === 1 ? 1.5 : 1}
            />
            <circle
              cx="32"
              cy="32"
              r="18.5"
              stroke={level >= 3 ? 'var(--hue-on-solid)' : 'var(--hue-solid)'}
              strokeOpacity="0.35"
              strokeWidth="0.75"
              strokeDasharray="1 2"
            />
          </>
        ) : (
          <circle
            cx="32"
            cy="32"
            r="27"
            stroke="var(--color-line-strong)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        )}
      </svg>
      {showGlyph ? (
        <Glyph
          aria-hidden
          strokeWidth={1.5}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            width: size * 0.3,
            height: size * 0.3,
            color: earned ? glyphColor : 'var(--color-ink-3)',
          }}
        />
      ) : null}
    </span>
  );
};
