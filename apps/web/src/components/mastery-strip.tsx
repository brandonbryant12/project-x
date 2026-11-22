import type { ProgressView } from '@repo/api';
import type { PersonId } from '@repo/domain';
import { cn, MasteryRing, Pill } from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';
import { queryOptions } from '@/lib/api.ts';

/**
 * MasteryStrip — shows every advisory skill in the firm's catalog as a
 * miniature Closing Mastery Ring so advisors immediately see which rings
 * are unlocked, which are actively closing in brass, and what is next.
 */
export const MasteryStrip = ({
  personId,
  progress,
  className,
}: {
  readonly personId: PersonId;
  readonly progress: ReadonlyArray<ProgressView>;
  readonly className?: string;
}) => {
  const catalog = useQuery(queryOptions('catalog', 'skills', { query: {} }));
  const profile = useQuery(queryOptions('people', 'profile', { params: { id: personId } }));

  const skills = catalog.data ?? [];
  if (skills.length === 0) return null;

  const heldBySkill = new Map<string, number>();
  for (const b of profile.data?.badges ?? []) {
    const prev = heldBySkill.get(b.skill.id) ?? 0;
    if (b.level > prev) heldBySkill.set(b.skill.id, b.level);
  }
  const progressBySkill = new Map<string, ProgressView>();
  for (const p of progress) {
    progressBySkill.set(p.skill.id, p);
    const maxHeld = p.heldLevels.length > 0 ? Math.max(...p.heldLevels) : 0;
    const prev = heldBySkill.get(p.skill.id) ?? 0;
    if (maxHeld > prev) heldBySkill.set(p.skill.id, maxHeld);
  }

  const unlockedCount = skills.filter((s) => (heldBySkill.get(s.id) ?? 0) > 0).length;
  const almostCount = progress.filter((p) => {
    const c = p.criteria[0];
    return c !== undefined && c.required - c.current === 1;
  }).length;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-sunken/70 px-4 py-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-ui font-medium text-ink">
          Advisory mastery
          <span className="ml-1.5 font-mono text-meta font-normal text-ink-3 tabular">
            {unlockedCount}/{skills.length} unlocked
          </span>
        </span>
        {almostCount > 0 ? (
          <Pill tone="brass">
            {almostCount} {almostCount === 1 ? 'skill' : 'skills'} 1 observation away
          </Pill>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="All advisory skills">
          {skills.map((s) => {
            const held = heldBySkill.get(s.id) ?? 0;
            const prog = progressBySkill.get(s.id);
            const primary = prog?.criteria[0];
            const current = primary?.current ?? 0;
            const required = primary?.required ?? 0;
            const statusText = (() => {
              if (held > 0) return `Level ${held} unlocked`;
              if (current > 0 && required > 0) return `${current}/${required} toward next level`;
              return 'Not started';
            })();
            return (
              <li key={s.id}>
                <Link
                  to="/catalog/skills/$slug"
                  params={{ slug: s.slug }}
                  title={`${s.name} — ${statusText}`}
                  aria-label={`${s.name}: ${statusText}`}
                  className="grid size-7 place-items-center rounded-full transition-transform hover:scale-110 hover:bg-surface"
                >
                  <MasteryRing level={held} current={current} required={required} size="xs" />
                </Link>
              </li>
            );
          })}
        </ul>
        <Link
          to="/catalog/skills"
          className="ml-1 inline-flex items-center gap-1 text-meta font-medium text-primary-ink hover:underline"
        >
          Catalog <ArrowRightIcon className="size-3" />
        </Link>
      </div>
    </div>
  );
};
