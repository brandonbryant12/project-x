import { cn } from '../lib/cn.ts';

const RING_SIZE = {
  xs: { px: 20, r: 7.5, stroke: 2.2, font: '' },
  sm: { px: 34, r: 13.5, stroke: 2.6, font: 'text-[9.5px]' },
  md: { px: 46, r: 18.5, stroke: 3.2, font: 'text-[11px]' },
  lg: { px: 64, r: 26, stroke: 3.8, font: 'text-[13px]' },
} as const;

/**
 * MasteryRing — the core skill acquisition visual, directly echoing the
 * Closing Mastery Ring logo:
 * - Untouched: quiet dashed ring
 * - Active progress: locked levels in pine ink + active next-level arc filling
 *   in warm catalyst brass (`current / required`)
 * - Unlocked: locked levels in pine (`L2`, `L3`, `L4`), with Level 4 closing
 *   360° plus a brass halo.
 *
 * Uses stroke-dasharray/dashoffset on `<circle>` geometry so live changes
 * (e.g. policy preview sliders or newly earned credit) interpolate smoothly.
 */
export const MasteryRing = ({
  level,
  current = 0,
  required = 0,
  size = 'md',
  className,
  label,
}: {
  /** Highest unlocked level (0–4). */
  readonly level: number;
  /** Observations accrued toward the next level (optional). */
  readonly current?: number;
  /** Observations required for the next level (optional). */
  readonly required?: number;
  readonly size?: keyof typeof RING_SIZE;
  readonly className?: string;
  readonly label?: string;
}) => {
  const spec = RING_SIZE[size];
  const cx = spec.px / 2;
  const circ = 2 * Math.PI * spec.r;
  const held = Math.min(4, Math.max(0, level));
  const ratio = required > 0 ? Math.min(1, Math.max(0, current / required)) : 0;
  const untouched = held === 0 && ratio === 0;
  const inProgress = held < 4 && ratio > 0;

  const pineDeg = held * 90;
  const pineLen = (pineDeg / 360) * circ;
  // Active next-level quadrant (90°) fills proportionally in warm brass
  const brassStartDeg = pineDeg + (held > 0 ? 6 : 0);
  const brassMaxSweep = held > 0 ? 78 : 86;
  const brassDeg = inProgress ? Math.max(18, Math.round(brassMaxSweep * ratio)) : 0;
  const brassLen = (brassDeg / 360) * circ;

  const centerText = (() => {
    if (size === 'xs') return null;
    if (inProgress && held === 0) return `${Math.min(current, required)}/${required}`;
    if (held > 0) return `L${held}`;
    return '0';
  })();

  const centerTone = (() => {
    if (inProgress && held === 0) return 'text-brass-ink';
    if (held > 0) return 'text-primary-ink';
    return 'text-ink-3';
  })();

  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: spec.px, height: spec.px }}
    >
      <svg viewBox={`0 0 ${spec.px} ${spec.px}`} width={spec.px} height={spec.px} fill="none">
        {untouched ? (
          <circle
            cx={cx}
            cy={cx}
            r={spec.r}
            stroke="var(--color-line-strong)"
            strokeWidth={Math.max(1.5, spec.stroke - 0.8)}
            strokeDasharray={size === 'xs' ? '2.5 2.5' : '4 4'}
          />
        ) : (
          <>
            <circle
              cx={cx}
              cy={cx}
              r={spec.r}
              stroke="var(--color-line)"
              strokeWidth={spec.stroke}
            />
            {held === 4 && size !== 'xs' ? (
              <circle
                cx={cx}
                cy={cx}
                r={spec.r + spec.stroke * 0.95}
                stroke="var(--color-brass)"
                strokeWidth="1.25"
                strokeOpacity="0.85"
                className="transition-opacity duration-300 ease-standard"
              />
            ) : null}
            <circle
              cx={cx}
              cy={cx}
              r={spec.r}
              stroke="var(--color-primary)"
              strokeWidth={spec.stroke}
              strokeLinecap={held === 4 ? 'butt' : 'round'}
              strokeDasharray={`${pineLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeOpacity={pineDeg > 0 ? 1 : 0}
              transform={`rotate(-90 ${cx} ${cx})`}
              className="transition-[stroke-dasharray,stroke-opacity] duration-500 ease-standard"
            />
            <circle
              cx={cx}
              cy={cx}
              r={spec.r}
              stroke="var(--color-brass)"
              strokeWidth={spec.stroke}
              strokeLinecap="round"
              strokeDasharray={`${brassLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeOpacity={brassDeg > 0 ? 1 : 0}
              transform={`rotate(${-90 + brassStartDeg} ${cx} ${cx})`}
              className="transition-[stroke-dasharray,stroke-opacity,transform] duration-500 ease-standard"
            />
          </>
        )}
      </svg>
      {centerText ? (
        <span
          className={cn(
            'absolute font-mono leading-none font-semibold tabular transition-colors duration-200',
            spec.font,
            centerTone,
          )}
        >
          {centerText}
        </span>
      ) : null}
    </span>
  );
};
