import type { IsoDate, PersonId } from '../ids.ts';
import { MAX_DESIGNATION_DAYS } from '../vocabulary.ts';
import { coachesOf, leaderChainOf, leaderOf, type RelationshipFacts } from './relationships.ts';

/**
 * Who may name a designated observer, and for whom (ADR 0020).
 *
 * D may designate O to observe S for [from, to) only if:
 *  1. on `from`, D is S's direct leader or an engaged coach of S;
 *  2. O is not S, not D, and does not report to S;
 *  3. the window is non-empty and at most MAX_DESIGNATION_DAYS long;
 *  4. no designation between O and S, in either direction, overlaps it. The
 *     reverse direction is refused so two peers cannot credit each other.
 */
export type DesignationCheck =
  | { readonly ok: true; readonly designatorBasis: 'leader' | 'coach' }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_leader_or_coach'
        | 'self'
        | 'designator_is_observer'
        | 'reports_to_subject'
        | 'bad_window'
        | 'overlaps_existing';
    };

export const DESIGNATION_REASON_TEXT: Readonly<
  Record<Extract<DesignationCheck, { ok: false }>['reason'], string>
> = {
  not_leader_or_coach: 'Only their leader or a coach engaged with them can designate an observer.',
  self: 'Nobody can be designated to observe their own work.',
  designator_is_observer: 'You can already observe them yourself.',
  reports_to_subject: 'Someone who reports to a person cannot credit that person.',
  bad_window: `Designations last between one day and ${MAX_DESIGNATION_DAYS} days.`,
  overlaps_existing: 'These two people already have a designation that overlaps these dates.',
};

const daysBetween = (from: IsoDate, to: IsoDate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const checkDesignation = (
  facts: RelationshipFacts,
  input: {
    readonly designatorId: PersonId;
    readonly observerId: PersonId;
    readonly subjectId: PersonId;
    readonly from: IsoDate;
    readonly to: IsoDate;
  },
): DesignationCheck => {
  const { designatorId, observerId, subjectId, from, to } = input;
  const isLeader = leaderOf(facts, subjectId, from) === designatorId;
  const isCoach = coachesOf(facts, subjectId, from).includes(designatorId);
  if (!isLeader && !isCoach) return { ok: false, reason: 'not_leader_or_coach' };
  if (observerId === subjectId) return { ok: false, reason: 'self' };
  if (observerId === designatorId) return { ok: false, reason: 'designator_is_observer' };
  if (leaderChainOf(facts, observerId, from).includes(subjectId)) {
    return { ok: false, reason: 'reports_to_subject' };
  }
  const length = daysBetween(from, to);
  if (length < 1 || length > MAX_DESIGNATION_DAYS) return { ok: false, reason: 'bad_window' };
  const overlaps = (facts.designations ?? []).some(
    (d) =>
      ((d.observerId === observerId && d.subjectId === subjectId) ||
        (d.observerId === subjectId && d.subjectId === observerId)) &&
      d.from < to &&
      (d.to === null || from < d.to),
  );
  if (overlaps) return { ok: false, reason: 'overlaps_existing' };
  return { ok: true, designatorBasis: isLeader ? 'leader' : 'coach' };
};
