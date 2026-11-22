import { CheckIcon } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import { LEVEL_LABELS } from './rating.tsx';

const SHORT_LEVEL_LABELS = ['Learning', 'With support', 'Independent', 'Teaching'] as const;

const barClass = (earned: boolean, isTarget: boolean) => {
  if (earned) return 'bg-primary';
  if (isTarget) return 'border border-dashed border-primary bg-primary-soft';
  return 'bg-sunken ring-1 ring-line';
};

const labelClass = (earned: boolean, isTarget: boolean) => {
  if (earned) return 'font-medium text-primary-ink';
  if (isTarget) return 'font-medium text-ink';
  return 'text-ink-3';
};

/**
 * Visual 4-step skill ladder: makes current standing and next milestone
 * legible in half a second without reading dense text checklists.
 */
export const SkillLadder = ({
  heldLevels,
  targetLevel,
  compact = false,
  className,
}: {
  readonly heldLevels: ReadonlyArray<number>;
  readonly targetLevel: number | null;
  readonly compact?: boolean;
  readonly className?: string;
}) => {
  const highestHeld = heldLevels.length > 0 ? Math.max(...heldLevels) : 0;
  return (
    <ol
      aria-label={`Skill level: ${highestHeld > 0 ? LEVEL_LABELS[highestHeld - 1] : 'In progress'}`}
      className={cn('grid grid-cols-4 gap-1.5', className)}
    >
      {[1, 2, 3, 4].map((level) => {
        const earned = level <= highestHeld;
        const isTarget = !earned && targetLevel === level;
        return (
          <li key={level} className="grid gap-1">
            <div className={cn('h-2 rounded-full transition-colors', barClass(earned, isTarget))} />
            {!compact ? (
              <span
                className={cn(
                  'flex items-center gap-0.5 truncate text-[11px] leading-tight',
                  labelClass(earned, isTarget),
                )}
              >
                {earned ? <CheckIcon aria-hidden className="size-3 shrink-0" /> : null}
                <span className="truncate">{SHORT_LEVEL_LABELS[level - 1]}</span>
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
};

/**
 * Visual progress bar for a skill's next milestone criterion (e.g. "1 of 2 observations").
 */
export const ProgressBar = ({
  current,
  required,
  label,
  className,
}: {
  readonly current: number;
  readonly required: number;
  readonly label?: string;
  readonly className?: string;
}) => {
  const clamped = Math.min(current, required);
  const pct = required > 0 ? Math.round((clamped / required) * 100) : 100;
  return (
    <div className={cn('grid gap-1.5', className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-2 text-meta">
          <span className="text-ink-2">{label}</span>
          <span className="font-medium text-ink tabular">
            {clamped}/{required}
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={required}
        className="h-2 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-line/80"
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            clamped >= required ? 'bg-success' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
