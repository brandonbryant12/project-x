import { cn } from '../lib/cn.ts';

/** A skill's place in one piece of work; `unclassified` only on credit from before roles. */
export type CreditRoleName = 'primary' | 'secondary' | 'unclassified';
/** Where a credit's value came from (`legacy`: signed before points existed). */
export type CreditSourceName = 'activity' | 'template' | 'skill' | 'tenant' | 'legacy';

/** Plain words for roles (CONTEXT.md). Credit from before roles is never called primary. */
export const CREDIT_ROLE_LABELS: Readonly<Record<CreditRoleName, string>> = {
  primary: 'Primary',
  secondary: 'Secondary',
  unclassified: 'Observed before roles',
};

/**
 * Said only when the value is not the usual one for the role: an individual
 * value set on that work, or the template's value copied onto it.
 */
export const CREDIT_SOURCE_NOTES: Readonly<Record<CreditSourceName, string | null>> = {
  activity: 'value set for this work',
  template: 'value from the template',
  skill: null,
  tenant: null,
  legacy: null,
};

const plural = (n: number) => (n === 1 ? 'point' : 'points');

/** "Primary · 12 points · value set for this work": what one credit added and why. */
export const CreditFacts = ({
  role,
  points,
  source,
  className,
}: {
  readonly role: CreditRoleName;
  readonly points: number;
  readonly source: CreditSourceName;
  readonly className?: string;
}) => {
  const note = CREDIT_SOURCE_NOTES[source];
  return (
    <span className={cn('text-meta text-ink-3 tabular', className)}>
      {CREDIT_ROLE_LABELS[role]} · {points} {plural(points)}
      {note ? ` · ${note}` : ''}
    </span>
  );
};
