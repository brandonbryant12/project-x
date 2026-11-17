import type { CreditId, IsoDate, InteractionId, PersonId } from '../ids.ts';
import {
  isFirstHand,
  LEVEL_NAMES,
  BADGE_LEVELS,
  type BadgeLevel,
  type Level,
  type CreditRole,
  type ObservationMode,
  type SkillRole,
} from '../vocabulary.ts';
import { LEGACY_CREDIT_POINTS, type CreditPolicy } from './policy.ts';

/**
 * Badge criteria over a person's net credits in one skill (credits that have
 * not been reversed). Pure: signing calls `evaluateBadge` and awards when
 * `met`; the UI shows `criteria` and `nextStep`.
 */
export interface CreditFact {
  readonly id: CreditId;
  readonly interactionId: InteractionId;
  readonly observerId: PersonId;
  readonly level: Level;
  readonly mode: ObservationMode;
  /** The interaction date: when the skill was shown, not when it was signed. */
  readonly demonstratedOn: IsoDate;
  /** Frozen at signing. */
  readonly points: number;
  /** `unclassified` for credits signed before roles existed: never primary. */
  readonly role: CreditRole;
}

/** The thresholds one badge is judged by, resolved for its skill; saved on every award. */
export interface BadgeCriteria {
  /** Points a badge needs: each piece of work counts once per skill, at its highest value. */
  readonly badgePoints: number;
  readonly minInteractions: number;
  readonly minObservers: number;
  /** Share of the pieces of work that must have been seen first-hand. */
  readonly minFirstHandShare: number;
  readonly minSpanDays: number;
  /** 0 is off. */
  readonly minPrimaryPoints: number;
}

/** A skill's own badge points and minimum primary points win over the tenant's. */
export const badgeCriteriaFor = (
  policy: CreditPolicy,
  skill?: { readonly badgePoints: number | null; readonly minPrimaryPoints: number | null } | null,
): BadgeCriteria => {
  const badgePoints = skill?.badgePoints ?? policy.badgePoints;
  return {
    badgePoints,
    minInteractions: policy.minInteractions,
    minObservers: policy.minObservers,
    minFirstHandShare: policy.minFirstHandShare,
    minSpanDays: policy.minSpanDays,
    minPrimaryPoints: Math.min(skill?.minPrimaryPoints ?? policy.minPrimaryPoints, badgePoints),
  };
};

const CRITERIA_KEYS = [
  'badgePoints',
  'minInteractions',
  'minObservers',
  'minFirstHandShare',
  'minSpanDays',
  'minPrimaryPoints',
] as const satisfies ReadonlyArray<keyof BadgeCriteria>;
const LEGACY_KEYS = [
  'minDemonstrations',
  'minObservers',
  'minFirstHandShare',
  'minSpanDays',
] as const;

export type SnapshotReading =
  | { readonly ok: true; readonly criteria: BadgeCriteria }
  | { readonly ok: false; readonly missing: ReadonlyArray<string> };

/**
 * The criteria an award was made under, read from its saved snapshot, never
 * from defaults. A legacy snapshot (`minDemonstrations`, no `badgePoints`)
 * converts deterministically from its own numbers: N pieces of work and N × 10
 * points (every legacy credit is worth 10), no primary-points requirement. A
 * snapshot that lacks a field is reported, not filled.
 */
export const criteriaFromSnapshot = (
  thresholds: Readonly<Record<string, number | undefined>>,
): SnapshotReading => {
  const isNumber = (key: string) =>
    typeof thresholds[key] === 'number' && Number.isFinite(thresholds[key]);
  if (thresholds['badgePoints'] === undefined && thresholds['minDemonstrations'] !== undefined) {
    const missing = LEGACY_KEYS.filter((k) => !isNumber(k));
    if (missing.length > 0) return { ok: false, missing };
    const n = thresholds['minDemonstrations'] as number;
    return {
      ok: true,
      criteria: {
        badgePoints: n * LEGACY_CREDIT_POINTS,
        minInteractions: n,
        minObservers: thresholds['minObservers'] as number,
        minFirstHandShare: thresholds['minFirstHandShare'] as number,
        minSpanDays: thresholds['minSpanDays'] as number,
        minPrimaryPoints: 0,
      },
    };
  }
  const missing = CRITERIA_KEYS.filter((k) => !isNumber(k));
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    criteria: Object.fromEntries(
      CRITERIA_KEYS.map((k) => [k, thresholds[k] as number]),
    ) as unknown as BadgeCriteria,
  };
};

/** One piece of work as it counts toward a skill. */
export interface WorkValue {
  readonly interactionId: InteractionId;
  readonly on: IsoDate;
  /** The highest points among its credits: what the work is worth. */
  readonly value: number;
  /** At least one of its credits was first-hand (saw it, reviewed the work). */
  readonly firstHand: boolean;
  /** The highest points among its primary credits (0 if none; unclassified is not primary). */
  readonly primaryValue: number;
  /** The credit whose points counted as `value`; the others are the same work. */
  readonly countedCreditId: CreditId;
  readonly creditIds: ReadonlyArray<CreditId>;
}

/**
 * THE projection of credits onto points: one piece of work counts once per
 * skill. Its value and its primary value are each the highest points among the
 * relevant credits, computed independently, so a secondary credit that outranks
 * a primary one never hides it; it is first-hand when any credit was. Badge evaluation, progress and
 * the badge receipt all read points through this; nothing sums credit rows.
 * Ties for the counted credit prefer primary, then first-hand, then the earlier id.
 */
export const projectWork = (credits: ReadonlyArray<CreditFact>): ReadonlyArray<WorkValue> => {
  const byWork = new Map<InteractionId, Array<CreditFact>>();
  for (const c of credits) byWork.set(c.interactionId, [...(byWork.get(c.interactionId) ?? []), c]);
  const highest = (list: ReadonlyArray<CreditFact>) => Math.max(0, ...list.map((c) => c.points));
  const rank = (c: CreditFact) => [
    c.points,
    c.role === 'primary' ? 1 : 0,
    isFirstHand(c.mode) ? 1 : 0,
  ];
  return [...byWork.entries()]
    .map(([interactionId, list]): WorkValue => {
      const counted = list.toSorted((a, b) => {
        const [x, y] = [rank(a), rank(b)];
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (y[i] ?? 0) - (x[i] ?? 0);
        return a.id.localeCompare(b.id);
      })[0] as CreditFact;
      return {
        interactionId,
        on: counted.demonstratedOn,
        value: counted.points,
        firstHand: list.some((c) => isFirstHand(c.mode)),
        primaryValue: highest(list.filter((c) => c.role === 'primary')),
        countedCreditId: counted.id,
        creditIds: list.map((c) => c.id),
      };
    })
    .toSorted((a, b) => a.on.localeCompare(b.on) || a.interactionId.localeCompare(b.interactionId));
};

export type CriterionKey =
  | 'points'
  | 'interactions'
  | 'primaryPoints'
  | 'observers'
  | 'firstHand'
  | 'span';

export interface Criterion {
  readonly key: CriterionKey;
  readonly current: number;
  readonly required: number;
  readonly met: boolean;
  /** Short fact, e.g. "20 of 30 points at doing independently or above". */
  readonly label: string;
}

export interface BadgeEvaluation {
  readonly level: BadgeLevel;
  readonly met: boolean;
  readonly criteria: ReadonlyArray<Criterion>;
  /** Distinct pieces of work at or above the level. */
  readonly demonstrations: number;
  /** Points toward the badge: each piece of work once, at its highest value. */
  readonly points: number;
  /** Of the work's points, those from primary credits. */
  readonly primaryPoints: number;
  readonly required: BadgeCriteria;
  /** The projection the evaluation used, for receipts. */
  readonly work: ReadonlyArray<WorkValue>;
}

const DAY_MS = 86_400_000;
const daysBetween = (a: IsoDate, b: IsoDate) =>
  Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const sum = (values: ReadonlyArray<number>) => values.reduce((a, b) => a + b, 0);

const criterion = (
  key: CriterionKey,
  current: number,
  required: number,
  label: string,
): Criterion => ({ key, current, required, met: current >= required, label });

export const evaluateBadge = (
  credits: ReadonlyArray<CreditFact>,
  level: BadgeLevel,
  required: BadgeCriteria,
): BadgeEvaluation => {
  const kept = credits.filter((c) => c.level >= level);
  const work = projectWork(kept);
  const demonstrations = work.length;
  const points = sum(work.map((w) => w.value));
  const primaryPoints = sum(work.map((w) => w.primaryValue));
  const firstHandWork = work.filter((w) => w.firstHand).length;
  const observers = new Set(kept.map((c) => c.observerId)).size;
  // A share of the pieces of work, never fewer than one, against a stable
  // target: the larger of the work so far and the work a badge needs. Points do
  // not weigh in (the rule from before points, with minInteractions in place of
  // the old minimum number of demonstrations).
  const firstHandNeeded = Math.max(
    1,
    Math.ceil(required.minFirstHandShare * Math.max(demonstrations, required.minInteractions)),
  );
  const first = work[0]?.on;
  const last = work.at(-1)?.on;
  const span = first !== undefined && last !== undefined ? daysBetween(first, last) : 0;
  const levelName = LEVEL_NAMES[level].toLowerCase();
  const upTo = Math.min;

  const criteria: Array<Criterion> = [
    criterion(
      'points',
      points,
      required.badgePoints,
      `${upTo(points, required.badgePoints)} of ${required.badgePoints} points at ${levelName} or above`,
    ),
    criterion(
      'interactions',
      demonstrations,
      required.minInteractions,
      `${upTo(demonstrations, required.minInteractions)} of ${required.minInteractions} times observed`,
    ),
  ];
  if (required.minPrimaryPoints > 0) {
    criteria.push(
      criterion(
        'primaryPoints',
        primaryPoints,
        required.minPrimaryPoints,
        `${upTo(primaryPoints, required.minPrimaryPoints)} of ${required.minPrimaryPoints} points as the main skill`,
      ),
    );
  }
  criteria.push(
    criterion(
      'observers',
      observers,
      required.minObservers,
      `${upTo(observers, required.minObservers)} of ${required.minObservers} ${plural(required.minObservers, 'observer')}`,
    ),
    criterion(
      'firstHand',
      firstHandWork,
      firstHandNeeded,
      `${upTo(firstHandWork, firstHandNeeded)} of ${firstHandNeeded} times observed first-hand`,
    ),
    criterion(
      'span',
      span,
      required.minSpanDays,
      span >= required.minSpanDays
        ? `Over ${Math.floor(span / 7)} weeks`
        : `${Math.floor(span / 7)} of ${Math.ceil(required.minSpanDays / 7)} weeks`,
    ),
  );

  return {
    level,
    met: criteria.every((c) => c.met),
    criteria,
    demonstrations,
    points,
    primaryPoints,
    required,
    work,
  };
};

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const say = (n: number) => NUMBER_WORDS[n] ?? String(n);
const gap = (c: Criterion) => c.required - c.current;

/**
 * One plain sentence describing the most useful next step. Benchmarks, not
 * ranks. With `values` (what one observation in this skill is worth), a points
 * gap is also said as a number of observations. Progress asks about a badge not
 * yet held, so "met" means it is awarded at the next signed observation (a
 * policy change never awards in bulk).
 */
export const nextStepSentence = (
  evaluation: BadgeEvaluation,
  skillName: string,
  values?: Readonly<Record<SkillRole, number>>,
): string => {
  const badge = `${skillName} · ${LEVEL_NAMES[evaluation.level]}`;
  const levelName = LEVEL_NAMES[evaluation.level].toLowerCase();
  if (evaluation.met) {
    return `You've met every criterion for ${badge}. It is awarded with your next signed observation of ${skillName}.`;
  }
  const unmet = (key: CriterionKey) => evaluation.criteria.find((c) => c.key === key && !c.met);
  const observations = (n: number) => {
    if (!values) return '';
    const count = Math.ceil(n / values.primary);
    return `, about ${say(count).toLowerCase()} more ${plural(count, 'observation')} with ${skillName} as the main skill`;
  };

  const points = unmet('points');
  if (points) {
    const n = gap(points);
    return `${say(n)} more ${plural(n, 'point')} at ${levelName} or above to earn ${badge}${observations(n)}.`;
  }
  const interactions = unmet('interactions');
  if (interactions) {
    const n = gap(interactions);
    return `Be observed ${say(n).toLowerCase()} more ${plural(n, 'time')} at ${levelName} or above to earn ${badge}.`;
  }
  const primary = unmet('primaryPoints');
  if (primary) {
    const n = gap(primary);
    return `${say(n)} more ${plural(n, 'point')} from work where ${skillName} is the main skill to earn ${badge}${observations(n)}.`;
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
