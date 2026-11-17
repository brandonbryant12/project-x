import type { BadgeReceiptView, BadgeView, PersonSummary, ReceiptCredit } from '@repo/api';
import {
  LEVEL_NAMES,
  criteriaFromSnapshot,
  projectWork,
  type CreditFact,
  type CreditId,
  type IsoDate,
  type Level,
  type ObservationId,
  type ObservationMode,
  type PersonId,
  type PointsSource,
} from '@repo/domain';

/** One credit behind a badge, as the receipt reads it. */
export interface ReceiptCreditFact extends CreditFact {
  readonly observationId: ObservationId;
  readonly pointsSource: PointsSource;
}

export interface ReceiptInput {
  readonly badge: BadgeView;
  readonly holder: PersonSummary;
  /** The award's saved snapshot: the thresholds it was judged by and its dates. */
  readonly snapshot: {
    readonly thresholds: Readonly<Record<string, number>>;
    readonly firstDemonstratedOn: IsoDate;
    readonly lastDemonstratedOn: IsoDate;
  };
  /** Every credit linked to the award, reversed ones included. */
  readonly credits: ReadonlyArray<ReceiptCreditFact>;
  /** Credits reversed since the award (their observation was voided). */
  readonly reversed: ReadonlySet<CreditId>;
  /** The viewer may see the holder's development (they, their coaches, their leader chain). */
  readonly detailVisible: boolean;
  readonly observer: (id: PersonId) => PersonSummary;
  /** The observer's words for a credit, or null where the viewer may not read them (I13). */
  readonly narrative: (credit: ReceiptCreditFact) => string | null;
}

const weeks = (days: number) => Math.max(1, Math.round(days / 7));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Assembles "How this was earned" (pure; `buildBadgeReceipt` loads its input).
 *
 * - Points go through the one projection (`projectWork`) over the credits that
 *   still stand: work two observers saw counts once, and a credit reversed
 *   since the award is left out of every count and the total, and marked.
 * - The total is set against what the badge needed when it was awarded (its
 *   saved thresholds), never today's policy.
 * - The badge is tenant-wide, but points, thresholds and each credit's role,
 *   source and level are development data (domain-model.md § Visibility): a
 *   viewer without development access gets the badge and the plain facts only,
 *   as before points existed.
 */
export const assembleBadgeReceipt = (input: ReceiptInput): BadgeReceiptView => {
  const standing = input.credits.filter((c) => !input.reversed.has(c.id));
  const counted = projectWork(standing);
  const valueOf = new Map(counted.map((w) => [w.interactionId, w]));
  const points = counted.reduce((sum, w) => sum + w.value, 0);
  const observers = new Set(standing.map((c) => c.observerId)).size;
  const firstHand = counted.filter((w) => w.firstHand).length;
  const span = Math.round(
    (Date.parse(input.snapshot.lastDemonstratedOn) -
      Date.parse(input.snapshot.firstDemonstratedOn)) /
      86_400_000,
  );
  const facts = [
    `Observed ${plural(counted.length, 'time', 'times')}`,
    ...(input.detailVisible ? [plural(points, 'point', 'points')] : []),
    plural(observers, 'observer', 'observers'),
    `${firstHand} seen first-hand`,
    `over ${weeks(span)} weeks`,
  ].join(' · ');
  const narrativesVisible =
    input.detailVisible && standing.some((c) => input.narrative(c) !== null);
  if (!input.detailVisible) {
    return {
      badge: input.badge,
      holder: input.holder,
      facts,
      narrativesVisible: false,
      detailVisible: false,
      points: null,
      required: null,
      work: [],
    };
  }
  const saved = criteriaFromSnapshot(input.snapshot.thresholds);
  const byId = new Map(input.credits.map((c) => [c.id, c]));
  const credit = (c: ReceiptCreditFact, countedId: CreditId | undefined): ReceiptCredit => ({
    id: c.observationId,
    observer: input.observer(c.observerId),
    level: c.level,
    levelName: LEVEL_NAMES[c.level as Level],
    mode: c.mode as ObservationMode,
    narrativeSaw: input.narrative(c),
    points: c.points,
    role: c.role,
    pointsSource: c.pointsSource,
    counted: c.id === countedId,
    reversed: input.reversed.has(c.id),
  });
  return {
    badge: input.badge,
    holder: input.holder,
    facts,
    narrativesVisible,
    detailVisible: true,
    points,
    required: saved.ok
      ? {
          points: saved.criteria.badgePoints,
          interactions: saved.criteria.minInteractions,
          observers: saved.criteria.minObservers,
          firstHandShare: saved.criteria.minFirstHandShare,
          spanDays: saved.criteria.minSpanDays,
          primaryPoints: saved.criteria.minPrimaryPoints,
        }
      : null,
    // Every piece of work in date order, reversed credit included so the record is whole.
    work: projectWork(input.credits).map((w) => {
      const standingWork = valueOf.get(w.interactionId);
      return {
        interactionId: w.interactionId,
        occurredOn: w.on,
        points: standingWork?.value ?? 0,
        credits: w.creditIds.flatMap((id) => {
          const c = byId.get(id);
          return c ? [credit(c, standingWork?.countedCreditId)] : [];
        }),
      };
    }),
  };
};
