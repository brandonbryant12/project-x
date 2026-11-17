import type { IsoDate, PersonId } from '../ids.ts';
import { hasCoachGrantOn, leaderOf, type RelationshipFacts } from './relationships.ts';

/**
 * Who may propose a coaching engagement, and in which direction.
 *
 * Either party may propose that C coaches E on date D, but only if:
 *  1. C is not E;
 *  2. on D, C holds an active `coach` grant;
 *  3. on D, C is not E's direct leader: the reporting line already makes the
 *     leader an observer (open question 6, working default);
 *  4. no engagement between C and E, in either direction, is live (proposed,
 *     active or paused): one coaching relationship per pair, so two people
 *     cannot coach each other at the same time.
 *
 * The profile offers each direction that passes, so a coach can ask another
 * coach to coach them, and a person who is not a coach is offered only the
 * direction in which the other person coaches.
 */
export type EngagementProposalCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'self' | 'not_a_coach' | 'leads_coachee' | 'already_engaged';
    };

export const ENGAGEMENT_PROPOSAL_REASON_TEXT: Readonly<
  Record<Extract<EngagementProposalCheck, { ok: false }>['reason'], string>
> = {
  self: 'Coaching needs two people.',
  not_a_coach: 'That person is not a coach.',
  leads_coachee: 'A leader does not coach their own report; the reporting line already covers it.',
  already_engaged: 'There is already an open coaching engagement between you.',
};

/** An engagement that is proposed, active or paused, as stored. */
export interface LiveEngagement {
  readonly coachId: PersonId;
  readonly coacheeId: PersonId;
}

export const checkEngagementProposal = (
  facts: RelationshipFacts,
  input: {
    readonly coachId: PersonId;
    readonly coacheeId: PersonId;
    readonly on: IsoDate;
    readonly live: ReadonlyArray<LiveEngagement>;
  },
): EngagementProposalCheck => {
  const { coachId, coacheeId, on, live } = input;
  if (coachId === coacheeId) return { ok: false, reason: 'self' };
  if (!hasCoachGrantOn(facts, coachId, on)) return { ok: false, reason: 'not_a_coach' };
  if (leaderOf(facts, coacheeId, on) === coachId) return { ok: false, reason: 'leads_coachee' };
  const engaged = live.some(
    (e) =>
      (e.coachId === coachId && e.coacheeId === coacheeId) ||
      (e.coachId === coacheeId && e.coacheeId === coachId),
  );
  if (engaged) return { ok: false, reason: 'already_engaged' };
  return { ok: true };
};

/** From the viewer's side: they coach the other person, or the other person coaches them. */
export const COACHING_DIRECTIONS = ['coach_them', 'coach_me'] as const;
export type CoachingDirection = (typeof COACHING_DIRECTIONS)[number];

/** The directions in which the viewer may propose coaching with another person today. */
export const proposableDirections = (
  facts: RelationshipFacts,
  input: {
    readonly viewerId: PersonId;
    readonly otherId: PersonId;
    readonly on: IsoDate;
    readonly live: ReadonlyArray<LiveEngagement>;
  },
): ReadonlyArray<CoachingDirection> => {
  const { viewerId, otherId, on, live } = input;
  const pairs: Record<CoachingDirection, { coachId: PersonId; coacheeId: PersonId }> = {
    coach_them: { coachId: viewerId, coacheeId: otherId },
    coach_me: { coachId: otherId, coacheeId: viewerId },
  };
  return COACHING_DIRECTIONS.filter(
    (direction) => checkEngagementProposal(facts, { ...pairs[direction], on, live }).ok,
  );
};
