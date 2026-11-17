import type { IsoDate, PersonId } from '../ids.ts';
import type { ObserverBasis } from '../vocabulary.ts';
import {
  coachesOf,
  designatedObserversOf,
  leaderChainOf,
  leaderOf,
  type RelationshipFacts,
} from './relationships.ts';

/**
 * Observer eligibility — docs/product/domain-model.md § "Eligible observer".
 *
 * O may sign an observation of S for an interaction on date D only if:
 *  1. O ≠ S
 *  2. on D, O was S's direct leader, or O held an active coach grant and an
 *     engagement with S accepted on or before D, or O was designated as an
 *     observer for S by S's leader or coach for a window covering D (ADR 0020)
 *  3. O does not report to S (directly or up the chain) on D
 *
 * The signing window (rule 4) is enforced by the observation lifecycle's expiry.
 */
export type EligibilityResult =
  | { readonly eligible: true; readonly basis: ObserverBasis }
  | {
      readonly eligible: false;
      readonly reason: 'self' | 'no_relationship' | 'reports_to_subject';
    };

export const INELIGIBLE_REASON_TEXT: Readonly<
  Record<Extract<EligibilityResult, { eligible: false }>['reason'], string>
> = {
  self: 'Nobody can observe their own work.',
  no_relationship:
    'Only their direct leader, a coach engaged with them, or a colleague designated for them on that date can observe this.',
  reports_to_subject: 'Someone who reports to a person cannot credit that person.',
};

export const checkObserverEligibility = (
  facts: RelationshipFacts,
  input: { readonly observerId: PersonId; readonly subjectId: PersonId; readonly on: IsoDate },
): EligibilityResult => {
  const { observerId, subjectId, on } = input;
  if (observerId === subjectId) return { eligible: false, reason: 'self' };

  if (leaderChainOf(facts, observerId, on).includes(subjectId)) {
    return { eligible: false, reason: 'reports_to_subject' };
  }
  if (leaderOf(facts, subjectId, on) === observerId) return { eligible: true, basis: 'leader' };
  if (coachesOf(facts, subjectId, on).includes(observerId)) {
    return { eligible: true, basis: 'coach' };
  }
  if (designatedObserversOf(facts, subjectId, on).includes(observerId)) {
    return { eligible: true, basis: 'designated' };
  }
  return { eligible: false, reason: 'no_relationship' };
};

/** Everyone who could observe the subject's work on `on`, with their basis. */
export const eligibleObserversOf = (
  facts: RelationshipFacts,
  subjectId: PersonId,
  on: IsoDate,
): ReadonlyArray<{ readonly personId: PersonId; readonly basis: ObserverBasis }> => {
  const candidates = new Set<PersonId>([
    ...coachesOf(facts, subjectId, on),
    ...designatedObserversOf(facts, subjectId, on),
  ]);
  const leader = leaderOf(facts, subjectId, on);
  if (leader !== undefined) candidates.add(leader);
  const result: Array<{ personId: PersonId; basis: ObserverBasis }> = [];
  for (const personId of candidates) {
    const check = checkObserverEligibility(facts, { observerId: personId, subjectId, on });
    if (check.eligible) result.push({ personId, basis: check.basis });
  }
  return result;
};

/**
 * Backdating bounds (independent review, 2026-11-16). Without them, three
 * back-dated interactions logged in one sitting would satisfy the 28-day span.
 */
export const LOG_WINDOW_DAYS = 30;
/** An observer may start "I saw this" for work up to this many days ago. */
export const OBSERVE_WINDOW_DAYS = 14;
