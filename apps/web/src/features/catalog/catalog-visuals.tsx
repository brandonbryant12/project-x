import type { CatalogInsights, SkillCard, SkillCombo } from '@repo/api';
import type { SkillId } from '@repo/domain';
import { Button, Card, cn, MasteryRing, Pill } from '@repo/ui';
import { Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';

export const SIGNAL_META: Record<
  SkillCard['signal'],
  { readonly label: string; readonly tone: 'primary' | 'brass' | 'info' | 'neutral' }
> = {
  popular: { label: 'Popular', tone: 'primary' },
  scarce: { label: 'Lacking in firm', tone: 'brass' },
  emerging: { label: 'Rising', tone: 'info' },
  balanced: { label: 'Steady', tone: 'neutral' },
};

const shortName = (name: string) => {
  const words = name.split(' ');
  return words.length <= 2 ? name : `${words[0]} ${words[1]}`;
};

const polarPoint = (cx: number, cy: number, radius: number, angleRad: number) => ({
  x: cx + radius * Math.cos(angleRad),
  y: cy + radius * Math.sin(angleRad),
});

/**
 * Bespoke radial Mastery Constellation (pure SVG):
 * plots your unlocked skill footprint (solid pine polygon) against your active
 * plan target silhouette (dashed brass polygon) across every skill in the catalog.
 */
export const SkillConstellation = ({
  skills,
  selectedSkillId,
  onSelect,
}: {
  readonly skills: ReadonlyArray<SkillCard>;
  readonly selectedSkillId?: SkillId | null;
  readonly onSelect?: (skill: SkillCard) => void;
}) => {
  if (skills.length < 3) return null;
  const cx = 160;
  const cy = 150;
  const maxR = 94;
  const count = skills.length;

  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / count;

  const levelRadius = (lvl: number) => (lvl / 4) * maxR;

  const currentPoints = skills
    .map((s, i) => {
      const effective =
        (s.myHighestLevel ?? 0) +
        (s.myRequired > 0 && s.myCurrent > 0
          ? Math.min(0.8, (s.myCurrent / s.myRequired) * 0.8)
          : 0);
      const p = polarPoint(cx, cy, Math.max(10, levelRadius(effective)), angleFor(i));
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');

  const targetPoints = skills
    .map((s, i) => {
      const goal = s.inMyPlan
        ? Math.max(3, s.myHighestLevel ?? 0)
        : Math.max(0.5, s.myHighestLevel ?? 0);
      const p = polarPoint(cx, cy, levelRadius(goal), angleFor(i));
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <Card className="grid gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-ink-3 uppercase">
            Your mastery shape
          </p>
          <p className="text-ui font-medium text-ink">Current standing vs. active focus</p>
        </div>
        <div className="flex items-center gap-3 text-meta text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" /> Earned
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full border border-dashed border-brass bg-brass-soft" />{' '}
            Focus
          </span>
        </div>
      </div>

      <svg
        viewBox="0 0 320 300"
        className="mx-auto w-full max-w-[320px] overflow-visible"
        role="img"
        aria-label="Radial chart comparing your earned skill levels with your active focus skills"
      >
        {[1, 2, 3, 4].map((ring) => (
          <circle
            key={ring}
            cx={cx}
            cy={cy}
            r={levelRadius(ring)}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={ring === 4 ? 1.1 : 0.8}
            strokeDasharray={ring === 4 ? undefined : '2.5 3'}
          />
        ))}
        {skills.map((s, i) => {
          const end = polarPoint(cx, cy, maxR, angleFor(i));
          return (
            <line
              key={`axis-${s.id}`}
              x1={cx}
              y1={cy}
              x2={end.x}
              y2={end.y}
              stroke="var(--color-line)"
              strokeWidth="0.75"
            />
          );
        })}

        <polygon
          points={targetPoints}
          fill="var(--color-brass)"
          fillOpacity="0.1"
          stroke="var(--color-brass)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          strokeLinejoin="round"
        />
        <polygon
          points={currentPoints}
          fill="var(--color-primary)"
          fillOpacity="0.2"
          stroke="var(--color-primary)"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {skills.map((s, i) => {
          const angle = angleFor(i);
          const effective = (s.myHighestLevel ?? 0) + (s.myCurrent > 0 ? 0.35 : 0);
          const dot = polarPoint(cx, cy, Math.max(10, levelRadius(effective)), angle);
          const lbl = polarPoint(cx, cy, maxR + 22, angle);
          const active = selectedSkillId === s.id;
          const anchor = (() => {
            if (Math.cos(angle) > 0.25) return 'start';
            if (Math.cos(angle) < -0.25) return 'end';
            return 'middle';
          })();
          return (
            <g
              key={s.id}
              className={onSelect ? 'cursor-pointer' : undefined}
              onClick={() => onSelect?.(s)}
            >
              <circle
                cx={dot.x}
                cy={dot.y}
                r={active ? 5 : 3.5}
                fill={s.myHighestLevel ? 'var(--color-primary)' : 'var(--color-brass)'}
                stroke="var(--color-surface)"
                strokeWidth="1.5"
              />
              <text
                x={lbl.x}
                y={lbl.y}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="fill-ink-2 text-[9.5px] font-medium"
              >
                {shortName(s.name)}
              </text>
            </g>
          );
        })}
      </svg>
    </Card>
  );
};

/**
 * Firm Skill Landscape: dual-layer bar chart showing badge holders (pine) +
 * active learners (brass) per skill so advisors spot popular vs. lacking skills in 2 seconds.
 */
export const SkillLandscapeChart = ({
  skills,
  totalPeople,
  onPickSkill,
}: {
  readonly skills: ReadonlyArray<SkillCard>;
  readonly totalPeople: number;
  readonly onPickSkill?: (skill: SkillCard) => void;
}) => {
  const maxVal = Math.max(4, ...skills.map((s) => s.holderCount + s.activeFocusCount));
  const sorted = skills.toSorted(
    (a, b) =>
      b.holderCount + b.activeFocusCount - (a.holderCount + a.activeFocusCount) ||
      a.name.localeCompare(b.name),
  );
  return (
    <Card className="grid gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-ink-3 uppercase">
            Firm skill landscape · {totalPeople} active people
          </p>
          <p className="text-ui font-medium text-ink">
            Where the firm is strong vs. where you can stand out
          </p>
        </div>
        <div className="flex items-center gap-3 text-meta text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-full bg-primary" /> Badge holders
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-full bg-brass" /> Focusing now
          </span>
        </div>
      </div>

      <ul className="grid gap-2.5">
        {sorted.map((s) => {
          const holderPct = Math.round((s.holderCount / maxVal) * 100);
          const focusPct = Math.round((s.activeFocusCount / maxVal) * 100);
          const sig = SIGNAL_META[s.signal];
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPickSkill?.(s)}
                className="group grid w-full cursor-pointer gap-1 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-sunken"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <MasteryRing
                      level={s.myHighestLevel ?? 0}
                      current={s.myCurrent}
                      required={s.myRequired}
                      size="xs"
                    />
                    <span className="truncate text-ui font-medium text-ink group-hover:text-primary-ink">
                      {s.name}
                    </span>
                    <span className="font-mono text-[10px] tracking-wider text-ink-3 uppercase">
                      {s.tier}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {s.signal !== 'balanced' ? <Pill tone={sig.tone}>{sig.label}</Pill> : null}
                    <span className="font-mono text-meta text-ink-3 tabular">
                      {s.holderCount} held · {s.activeFocusCount} active
                    </span>
                  </span>
                </div>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-line/70">
                  {holderPct > 0 ? (
                    <span
                      className="h-full bg-primary transition-all"
                      style={{ width: `${holderPct}%` }}
                    />
                  ) : null}
                  {focusPct > 0 ? (
                    <span
                      className="h-full bg-brass/85 transition-all"
                      style={{ width: `${focusPct}%` }}
                    />
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

/**
 * RareComboCard — visualizes a rare cross-domain 2-skill pairing with two
 * MasteryRings bridged by a curved brass catalyst arc and a 1-click plan CTA.
 */
export const RareComboCard = ({
  combo,
  skillById,
  onBuildCombo,
}: {
  readonly combo: SkillCombo;
  readonly skillById: ReadonlyMap<SkillId, SkillCard>;
  readonly onBuildCombo: (skillIds: ReadonlyArray<SkillId>) => void;
}) => {
  const [a, b] = combo.skills;
  const cardA = skillById.get(a.id);
  const cardB = skillById.get(b.id);
  const rarityLabel =
    combo.jointHolders === 0 ? 'Unclaimed combo' : `Only ${combo.jointHolders} in firm`;
  return (
    <Card
      className={cn(
        'flex flex-col justify-between gap-3.5 p-4',
        combo.matchesViewer && 'border-brass/60 ring-1 ring-brass/20',
      )}
    >
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <Pill tone={combo.matchesViewer ? 'brass' : 'outline'}>{rarityLabel}</Pill>
          {combo.matchesViewer ? (
            <span className="font-mono text-[10.5px] font-medium text-brass-ink">
              Matches your progress
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/catalog/skills/$slug"
            params={{ slug: a.slug }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-control p-1 hover:bg-sunken"
          >
            <MasteryRing
              level={cardA?.myHighestLevel ?? 0}
              current={cardA?.myCurrent ?? 0}
              required={cardA?.myRequired ?? 0}
              size="sm"
            />
            <span className="truncate text-ui font-semibold text-ink">{a.name}</span>
          </Link>

          <svg
            viewBox="0 0 28 16"
            width="24"
            height="14"
            fill="none"
            aria-hidden
            className="shrink-0"
          >
            <path
              d="M 2 11 Q 14 2 26 11"
              stroke="var(--color-brass)"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeDasharray="3 2.5"
            />
          </svg>

          <Link
            to="/catalog/skills/$slug"
            params={{ slug: b.slug }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-control p-1 hover:bg-sunken"
          >
            <MasteryRing
              level={cardB?.myHighestLevel ?? 0}
              current={cardB?.myCurrent ?? 0}
              required={cardB?.myRequired ?? 0}
              size="sm"
            />
            <span className="truncate text-ui font-semibold text-ink">{b.name}</span>
          </Link>
        </div>

        <p className="text-meta text-ink-2">{combo.rationale}</p>
      </div>

      <div className="flex justify-end border-t border-line pt-3">
        <Button
          size="sm"
          variant={combo.matchesViewer ? 'primary' : 'secondary'}
          onClick={() => onBuildCombo([a.id, b.id])}
        >
          <PlusIcon /> Plan this combo
        </Button>
      </div>
    </Card>
  );
};

/** Helper to check if a set of selected skills forms a rare combo in the firm. */
export const findMatchingRareCombo = (
  selected: ReadonlyArray<SkillId>,
  insights: CatalogInsights | undefined,
): SkillCombo | null => {
  if (!insights || selected.length < 2) return null;
  const set = new Set(selected);
  return (
    insights.rareCombos.find((c) => set.has(c.skills[0].id) && set.has(c.skills[1].id)) ?? null
  );
};
