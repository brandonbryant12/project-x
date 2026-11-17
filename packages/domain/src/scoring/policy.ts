/**
 * Scoring policy. A credit is one *demonstration*: a skill shown at a level,
 * in a mode, seen by one observer, in one interaction. There are no points
 * (red-team 2026-11-16): they measured volume, not development. Criteria count
 * demonstrations, observers, first-hand share and time.
 */
export const SCORING_POLICY_VERSION = 'scoring/2026-11-16.2';

/** An observation may rate at most this many skills. */
export const MAX_SKILLS_PER_OBSERVATION = 3;
