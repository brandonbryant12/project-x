import type { IsoDate, InteractionId, PersonId } from '../ids.ts';
import {
  isFirstHand,
  LEVEL_NAMES,
  BADGE_LEVELS,
  type BadgeLevel,
  type Level,
  type ObservationMode,
} from '../vocabulary.ts';

/**
 * Badge criteria over a person's net demonstrations in one skill (credits that
 * have not been reversed). Pure: signing calls `evaluateBadge` and awards when
 * `met`; the UI shows `criteria` and `nextStep`.
 */
export interface CreditFact {
  readonly interactionId: InteractionId;
  readonly observerId: PersonId;
  readonly level: Level;
  readonly mode: ObservationMode;
  /** The interaction date: when the skill was shown, not when it was signed. */
  readonly demonstratedOn: IsoDate;
}

export interface BadgeCriteriaConfig {
  /** Distinct interactions with a demonstration at or above the badge level. */
  readonly minDemonstrations: number;
  readonly minObservers: number;
  /** Share of at-level demonstrations that must be first-hand (saw it / reviewed work). */
  readonly minFirstHandShare: number;
  readonly minSpanDays: number;
}

/** Strict enterprise preset: multi-observer, 4-week span (ADR 0007). */
export const STRICT_BADGE_CRITERIA: BadgeCriteriaConfig = {
  minDemonstrations: 3,
  minObservers: 2,
  minFirstHandShare: 0.5,
  minSpanDays: 28,
};

/**
 * Active defaults (simplified POC preset): 2 observations (at least 1 first-hand),
 * no multi-week wait or second-observer lock. Tenants can tighten to
 * `STRICT_BADGE_CRITERIA` via tenant settings without code changes.
 */
export const DEFAULT_BADGE_CRITERIA: BadgeCriteriaConfig = {
  minDemonstrations: 2,
  minObservers: 1,
  minFirstHandShare: 0.5,
  minSpanDays: 0,
};

export type CriterionKey = 'demonstrations' | 'observers' | 'firstHand' | 'span';

export interface Criterion {
  readonly key: CriterionKey;
  readonly current: number;
  readonly required: number;
  readonly met: boolean;
  /** Short fact, e.g. "2 of 3 demonstrations". */
  readonly label: string;
}

export interface BadgeEvaluation {
  readonly level: BadgeLevel;
  readonly met: boolean;
  readonly criteria: ReadonlyArray<Criterion>;
  /** Distinct interactions at or above the level. */
  readonly demonstrations: number;
}

const DAY_MS = 86_400_000;
const daysBetween = (a: IsoDate, b: IsoDate) =>
  Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

const criterion = (
  key: CriterionKey,
  current: number,
  required: number,
  label: string,
): Criterion => ({
  key,
  current,
  required,
  met: current >= required,
  label,
});

export const evaluateBadge = (
  credits: ReadonlyArray<CreditFact>,
  level: BadgeLevel,
  config: BadgeCriteriaConfig = DEFAULT_BADGE_CRITERIA,
): BadgeEvaluation => {
  const atLevel = credits.filter((c) => c.level >= level);
  const interactions = new Set(atLevel.map((c) => c.interactionId));
  const firstHandInteractions = new Set(
    atLevel.filter((c) => isFirstHand(c.mode)).map((c) => c.interactionId),
  );
  const observers = new Set(atLevel.map((c) => c.observerId)).size;
  const demonstrations = interactions.size;
  // A true share of the at-level demonstrations (never fewer than one), so ten
  // discussed plus two first-hand does not pass a "half first-hand" rule.
  const firstHandNeeded = Math.max(
    1,
    Math.ceil(Math.max(demonstrations, config.minDemonstrations) * config.minFirstHandShare),
  );
  const dates = atLevel.map((c) => c.demonstratedOn).toSorted();
  const first = dates[0];
  const last = dates.at(-1);
  const span = first !== undefined && last !== undefined ? daysBetween(first, last) : 0;
  const levelName = LEVEL_NAMES[level].toLowerCase();

  const criteria: Array<Criterion> = [
    criterion(
      'demonstrations',
      demonstrations,
      config.minDemonstrations,
      `${Math.min(demonstrations, config.minDemonstrations)} of ${config.minDemonstrations} ${plural(config.minDemonstrations, 'observation')} at ${levelName} or above`,
    ),
  ];
  if (config.minObservers > 1) {
    criteria.push(
      criterion(
        'observers',
        observers,
        config.minObservers,
        `${Math.min(observers, config.minObservers)} of ${config.minObservers} ${plural(config.minObservers, 'observer')}`,
      ),
    );
  }
  if (config.minFirstHandShare > 0) {
    criteria.push(
      criterion(
        'firstHand',
        firstHandInteractions.size,
        firstHandNeeded,
        `${Math.min(firstHandInteractions.size, firstHandNeeded)} of ${firstHandNeeded} seen first-hand`,
      ),
    );
  }
  if (config.minSpanDays > 0) {
    criteria.push(
      criterion(
        'span',
        span,
        config.minSpanDays,
        span >= config.minSpanDays
          ? `Over ${Math.floor(span / 7)} weeks`
          : `${Math.floor(span / 7)} of ${Math.ceil(config.minSpanDays / 7)} weeks`,
      ),
    );
  }

  return { level, met: criteria.every((c) => c.met), criteria, demonstrations };
};

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const say = (n: number) => NUMBER_WORDS[n] ?? String(n);
const gap = (c: Criterion) => c.required - c.current;

/** One plain sentence describing the most useful next step. Benchmarks, not ranks. */
export const nextStepSentence = (evaluation: BadgeEvaluation, skillName: string): string => {
  const badge = `${skillName} · ${LEVEL_NAMES[evaluation.level]}`;
  if (evaluation.met) return `You've met every criterion for ${badge}.`;
  const unmet = (key: CriterionKey) => evaluation.criteria.find((c) => c.key === key && !c.met);

  const demos = unmet('demonstrations');
  if (demos) {
    const n = gap(demos);
    return `Be observed ${say(n).toLowerCase()} more ${plural(n, 'time')} at ${LEVEL_NAMES[evaluation.level].toLowerCase()} or above to earn ${badge}.`;
  }
  const observers = unmet('observers');
  if (observers) {
    return gap(observers) === 1
      ? `One more observation from a second observer to earn ${badge}.`
      : `Observations from ${say(gap(observers)).toLowerCase()} more observers to earn ${badge}.`;
  }
  const firstHand = unmet('firstHand');
  if (firstHand) {
    const n = gap(firstHand);
    return `${say(n)} more ${plural(n, 'observation')} where your observer saw the work or reviewed it to earn ${badge}.`;
  }
  const span = unmet('span');
  if (span) {
    return `Keep going: ${badge} needs ${Math.ceil(span.required / 7)} weeks of practice, about ${gap(span)} more days.`;
  }
  return `Keep going toward ${badge}.`;
};

/** The badge level to show progress toward: the lowest one not yet held. */
export const nextBadgeLevel = (held: ReadonlyArray<BadgeLevel>): BadgeLevel | undefined =>
  BADGE_LEVELS.find((level) => !held.includes(level));
