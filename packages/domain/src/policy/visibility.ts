import type { IsoDate, PersonId } from '../ids.ts';
import { coachesOf, leaderChainOf, type RelationshipFacts } from './relationships.ts';

/**
 * Who may see a person's development (plans, progress, interactions,
 * observations, narratives): the person, their active coaches, and their leader
 * chain. The catalog, earned badges and directory are visible tenant-wide and do
 * not go through this policy. See domain-model.md § Visibility.
 */
export type DevelopmentAccess = 'self' | 'coach' | 'leader' | 'none';

export const developmentAccess = (
  facts: RelationshipFacts,
  input: { readonly viewerId: PersonId; readonly subjectId: PersonId; readonly on: IsoDate },
): DevelopmentAccess => {
  const { viewerId, subjectId, on } = input;
  if (viewerId === subjectId) return 'self';
  if (coachesOf(facts, subjectId, on).includes(viewerId)) return 'coach';
  if (leaderChainOf(facts, subjectId, on).includes(viewerId)) return 'leader';
  return 'none';
};

export const canViewDevelopment = (
  facts: RelationshipFacts,
  input: { readonly viewerId: PersonId; readonly subjectId: PersonId; readonly on: IsoDate },
): boolean => developmentAccess(facts, input) !== 'none';

/**
 * Narratives are more sensitive than levels (red-team 2026-11-16): the subject,
 * the observer who wrote it, active coaches and the direct leader read them.
 * The wider leader chain sees levels and coverage only.
 */
export const canReadNarrative = (
  facts: RelationshipFacts,
  input: {
    readonly viewerId: PersonId;
    readonly subjectId: PersonId;
    readonly observerId: PersonId;
    readonly on: IsoDate;
  },
): boolean => {
  if (input.viewerId === input.observerId) return true;
  const access = developmentAccess(facts, input);
  if (access === 'self' || access === 'coach') return true;
  return (
    access === 'leader' && leaderChainOf(facts, input.subjectId, input.on)[0] === input.viewerId
  );
};
