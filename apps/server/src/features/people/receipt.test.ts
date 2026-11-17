import type { PersonSummary } from '@repo/api';
import type {
  BadgeAwardId,
  CreditId,
  InteractionId,
  IsoDate,
  ObservationId,
  PersonId,
  SkillId,
} from '@repo/domain';
import { describe, expect, it } from 'vitest';
import { assembleBadgeReceipt, type ReceiptCreditFact, type ReceiptInput } from './receipt.ts';

/**
 * "How this was earned" (I33, I48), assembled purely from the award's credits:
 * credit from before roles (`unclassified`, source `legacy`) is labelled as such
 * and still counts its value; credit reversed since the award is marked and
 * left out of the total and every count; and a viewer without development
 * access gets the badge and the plain facts, never points or per-credit detail.
 * The database proof of legacy rows is `packages/db/src/migration-compat.test.ts`.
 */
const person = (id: string): PersonSummary => ({
  id: id as PersonId,
  displayName: id,
  title: null,
  initials: id.slice(0, 2).toUpperCase(),
  hue: 0,
});

const credit = (n: number, overrides: Partial<ReceiptCreditFact> = {}): ReceiptCreditFact => ({
  id: `crd_${n}` as CreditId,
  observationId: `obs_${n}` as ObservationId,
  interactionId: `int_${n}` as InteractionId,
  observerId: 'per_leo' as PersonId,
  level: 2,
  mode: 'saw_it',
  demonstratedOn: `2026-06-0${n}` as IsoDate,
  points: 10,
  role: 'primary',
  pointsSource: 'tenant',
  ...overrides,
});

const input = (overrides: Partial<ReceiptInput> = {}): ReceiptInput => ({
  badge: {
    id: 'bdg_1' as BadgeAwardId,
    skill: {
      id: 'skl_1' as SkillId,
      slug: 'discovery',
      name: 'Discovery',
      domain: 'client_discovery',
    },
    level: 2,
    levelName: 'Doing with support',
    awardedAt: '2026-07-01T12:00:00.000Z',
  },
  holder: person('per_ada'),
  snapshot: {
    thresholds: {
      badgePoints: 30,
      minInteractions: 3,
      minObservers: 2,
      minFirstHandShare: 0.5,
      minSpanDays: 0,
      minPrimaryPoints: 0,
    },
    firstDemonstratedOn: '2026-06-01' as IsoDate,
    lastDemonstratedOn: '2026-06-03' as IsoDate,
  },
  credits: [
    credit(1),
    credit(2, { observerId: 'per_sam' as PersonId }),
    credit(3, { points: 3, role: 'secondary' }),
  ],
  reversed: new Set(),
  detailVisible: true,
  observer: person,
  narrative: () => 'She asked first.',
  ...overrides,
});

describe('how a badge was earned', () => {
  it('labels credit from before roles and still counts its value', () => {
    const receipt = assembleBadgeReceipt(
      input({
        credits: [
          credit(1, { role: 'unclassified', pointsSource: 'legacy' }),
          credit(2, { observerId: 'per_sam' as PersonId }),
        ],
      }),
    );
    expect(receipt.points).toBe(20);
    expect(receipt.work[0]?.credits[0]).toMatchObject({
      role: 'unclassified',
      pointsSource: 'legacy',
      points: 10,
      counted: true,
      reversed: false,
    });
  });

  it('marks credit reversed since the award and leaves it out of the total and the counts', () => {
    const receipt = assembleBadgeReceipt(
      input({
        // The second observer of the first piece of work was voided, and so was the third piece.
        credits: [
          credit(1, { points: 12 }),
          credit(4, {
            interactionId: 'int_1' as InteractionId,
            observerId: 'per_sam' as PersonId,
            points: 15,
            demonstratedOn: '2026-06-01' as IsoDate,
          }),
          credit(2, { observerId: 'per_sam' as PersonId }),
          credit(3, { points: 3, role: 'secondary' }),
        ],
        reversed: new Set(['crd_4', 'crd_3'] as Array<CreditId>),
      }),
    );
    expect(receipt.points).toBe(22);
    expect(receipt.facts).toMatch(/^Observed 2 times · 22 points · 2 observers/);
    expect(
      receipt.work.map((w) => [w.points, w.credits.map((c) => [c.id, c.counted, c.reversed])]),
    ).toEqual([
      [
        12,
        [
          ['obs_1', true, false],
          ['obs_4', false, true],
        ],
      ],
      [10, [['obs_2', true, false]]],
      [0, [['obs_3', false, true]]],
    ]);
  });

  it('gives a viewer without development access the badge and plain facts only', () => {
    const receipt = assembleBadgeReceipt(input({ detailVisible: false }));
    expect(receipt).toMatchObject({
      detailVisible: false,
      narrativesVisible: false,
      points: null,
      required: null,
      work: [],
    });
    expect(receipt.facts).toBe('Observed 3 times · 2 observers · 3 seen first-hand · over 1 weeks');
  });
});
