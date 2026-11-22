import { RadioGroup } from 'radix-ui';
import { Checkbox } from '../components/checkbox.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/overlays.tsx';
import { cn } from '../lib/cn.ts';

export const LEVEL_LABELS = [
  'Learning',
  'Doing with support',
  'Doing independently',
  'Teaching others',
] as const;

/**
 * Four-level picker with radio-group semantics (roving tabindex via Radix).
 * When the skill's level descriptors are passed they sit inside each option,
 * so the observer calibrates against the ladder without opening anything.
 * `row` is four columns (desktop); `list` stacks the ladder (phones).
 */
export const LevelPicker = ({
  value,
  onChange,
  descriptions,
  name,
  layout = 'row',
  disabled = false,
}: {
  readonly value: number | null;
  readonly onChange: (level: 1 | 2 | 3 | 4) => void;
  readonly descriptions?: ReadonlyArray<string>;
  readonly name: string;
  readonly layout?: 'row' | 'list';
  readonly disabled?: boolean;
}) => (
  <RadioGroup.Root
    aria-label={name}
    value={value === null ? '' : String(value)}
    onValueChange={(v) => onChange(Number(v) as 1 | 2 | 3 | 4)}
    disabled={disabled}
    className={cn(
      'grid gap-1 rounded-control border border-line bg-sunken p-1',
      layout === 'row' ? 'grid-cols-4' : 'grid-cols-1',
    )}
  >
    {LEVEL_LABELS.map((label, i) => {
      const description = descriptions?.[i]?.trim();
      return (
        <RadioGroup.Item
          key={label}
          value={String(i + 1)}
          className={cn(
            'group grid cursor-pointer content-start rounded-[5px] px-2.5 text-left transition-[background-color,box-shadow,transform] duration-150 ease-standard hover:bg-surface/75 active:scale-[0.99] data-[state=checked]:bg-surface data-[state=checked]:shadow-sm data-[state=checked]:ring-1 data-[state=checked]:ring-primary/45',
            layout === 'row'
              ? 'gap-0.5 py-2'
              : 'min-h-11 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1.5 py-2.5',
          )}
        >
          <span className="font-mono text-meta leading-tight text-ink-3 tabular transition-colors group-data-[state=checked]:font-semibold group-data-[state=checked]:text-primary-ink">
            {i + 1}
          </span>
          <span className="text-ui leading-tight font-medium text-ink">{label}</span>
          {description ? (
            <span
              className={cn(
                'mt-1 text-meta text-ink-3 group-data-[state=checked]:text-ink-2',
                layout === 'list' && 'col-start-2 mt-0.5',
              )}
            >
              {description}
            </span>
          ) : null}
        </RadioGroup.Item>
      );
    })}
  </RadioGroup.Root>
);

export const IndicatorRow = ({
  id,
  text,
  checked,
  onCheckedChange,
  assistantMatch = false,
  disabled = false,
}: {
  readonly id: string;
  readonly text: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly assistantMatch?: boolean;
  readonly disabled?: boolean;
}) => (
  <label
    htmlFor={id}
    className={cn(
      'flex min-h-11 cursor-pointer items-start gap-3 rounded-control px-2.5 py-2.5 transition-colors duration-120 hover:bg-sunken',
      checked && 'bg-primary-soft/50 hover:bg-primary-soft/70',
    )}
  >
    <Checkbox
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(c) => onCheckedChange(c === true)}
      className="mt-0.5"
      aria-describedby={assistantMatch ? `${id}-assist` : undefined}
    />
    <span className="flex-1 text-body text-ink">{text}</span>
    {assistantMatch ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            id={`${id}-assist`}
            className="mt-0.5 shrink-0 rounded-full border border-dashed border-info/60 px-2 py-0.5 text-meta text-info-ink"
          >
            In your note
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Your note appears to describe this. An automated check; you decide whether to tick it.
        </TooltipContent>
      </Tooltip>
    ) : null}
  </label>
);

/**
 * A rating, not an achievement: four short bars filled to the level observed.
 * Seals are reserved for badges (ux-brief §4) so the two never read alike.
 */
export const LevelMeter = ({
  level,
  className,
}: {
  readonly level: number | null;
  readonly className?: string;
}) => (
  <span
    role="img"
    aria-label={level ? `Level ${level} of 4: ${LEVEL_LABELS[level - 1]}` : 'No level'}
    className={cn('inline-flex items-end gap-0.5', className)}
  >
    {[1, 2, 3, 4].map((i) => (
      <span
        key={i}
        className={cn(
          'w-1.5 rounded-[1px]',
          i <= (level ?? 0) ? 'bg-primary' : 'bg-line-strong/70',
        )}
        style={{ height: 6 + i * 3 }}
      />
    ))}
  </span>
);
