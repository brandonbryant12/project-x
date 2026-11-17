import type { Actor, ProgressView } from '@repo/api';
import {
  BADGE_LEVELS,
  BadgeAwardId,
  DEFAULT_BADGE_CRITERIA,
  LEVEL_NAMES,
  SCORING_POLICY_VERSION,
  evaluateBadge,
  nextBadgeLevel,
  nextStepSentence,
  type BadgeCriteriaConfig,
  type BadgeLevel,
  type CreditFact,
  type IsoDate,
  type Level,
  type ObservationId,
  type ObservationMode,
  type PersonId,
  type SkillId,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../../platform/time.ts';
import { recordAudit } from './audit.ts';
import { loadSkills, toSkillRef } from './skills.ts';

/** Tenant-tuned badge numbers over the fixed structure (ADR 0007). */
export const tenantCriteria = Effect.fn('tenant.criteria')(function* (tenantId: TenantId) {
  const db = yield* Db;
  const [row] = yield* db
    .select({ settings: schema.tenant.settings })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, tenantId));
  const overrides = row?.settings.badgeCriteria ?? {};
  return { ...DEFAULT_BADGE_CRITERIA, ...overrides } satisfies BadgeCriteriaConfig;
});

type CreditRow = typeof schema.creditEntry.$inferSelect;

/** Credits that have not been reversed, grouped by skill. */
export const netCreditsBySkill = Effect.fn('credits.net')(function* (
  tenantId: TenantId,
  personId: PersonId,
  skillIds?: ReadonlyArray<SkillId>,
) {
  const db = yield* Db;
  const conditions = [
    eq(schema.creditEntry.tenantId, tenantId),
    eq(schema.creditEntry.personId, personId),
  ];
  if (skillIds) {
    if (skillIds.length === 0) return new Map<SkillId, Array<CreditRow>>();
    conditions.push(inArray(schema.creditEntry.skillId, [...skillIds]));
  }
  const rows = yield* db
    .select({ credit: schema.creditEntry, reversalId: schema.creditReversal.id })
    .from(schema.creditEntry)
    .leftJoin(schema.creditReversal, eq(schema.creditReversal.creditEntryId, schema.creditEntry.id))
    .where(and(...conditions));
  const bySkill = new Map<SkillId, Array<CreditRow>>();
  for (const { credit: row, reversalId } of rows) {
    if (reversalId !== null) continue;
    const list = bySkill.get(row.skillId) ?? [];
    list.push(row);
    bySkill.set(row.skillId, list);
  }
  return bySkill;
});

export const toCreditFact = (row: CreditRow): CreditFact => ({
  interactionId: row.interactionId,
  observerId: row.observerId,
  level: row.level as Level,
  mode: row.mode as ObservationMode,
  demonstratedOn: row.demonstratedOn,
});

export const heldBadges = Effect.fn('badges.held')(function* (
  tenantId: TenantId,
  personId: PersonId,
) {
  const db = yield* Db;
  return yield* db
    .select()
    .from(schema.badgeAward)
    .where(
      and(
        eq(schema.badgeAward.tenantId, tenantId),
        eq(schema.badgeAward.personId, personId),
        eq(schema.badgeAward.status, 'awarded'),
      ),
    );
});

/** Progress views for a person's skills: benchmarks toward the next badge. */
export const progressFor = Effect.fn('progress.for')(function* (
  tenantId: TenantId,
  personId: PersonId,
  skillIds: ReadonlyArray<SkillId>,
) {
  if (skillIds.length === 0) return [] as Array<ProgressView>;
  const [criteria, credits, badges, skills] = yield* Effect.all([
    tenantCriteria(tenantId),
    netCreditsBySkill(tenantId, personId, skillIds),
    heldBadges(tenantId, personId),
    loadSkills(tenantId, skillIds),
  ]);
  return skillIds.flatMap((skillId): Array<ProgressView> => {
    const skill = skills.get(skillId);
    if (!skill) return [];
    const facts = (credits.get(skillId) ?? []).map(toCreditFact);
    const held = badges
      .filter((b) => b.skillId === skillId)
      .map((b) => b.level)
      .toSorted();
    const target = nextBadgeLevel(held.filter((l): l is BadgeLevel => l === 2 || l === 3));
    const evaluation = evaluateBadge(facts, target ?? 3, criteria);
    const lastOn =
      facts
        .map((f) => f.demonstratedOn)
        .toSorted()
        .at(-1) ?? null;
    return [
      {
        skill: toSkillRef(skill),
        heldLevels: held,
        targetLevel: target ?? null,
        targetLevelName: target ? LEVEL_NAMES[target] : null,
        demonstrations: evaluation.demonstrations,
        criteria: target ? evaluation.criteria : [],
        nextStep: target
          ? nextStepSentence(evaluation, skill.name)
          : `You hold every badge for ${skill.name}.`,
        lastDemonstratedOn: lastOn,
      },
    ];
  });
});

/**
 * Evaluates badge criteria for the given skills and awards any newly met
 * badges. Runs inside the signing transaction; every input was human-signed.
 */
export const awardEarnedBadges = Effect.fn('badges.award')(function* (
  actor: Actor,
  personId: PersonId,
  skillIds: ReadonlyArray<SkillId>,
  triggeringObservationId: ObservationId,
) {
  const db = yield* Db;
  const [criteria, credits, badges] = yield* Effect.all([
    tenantCriteria(actor.tenantId),
    netCreditsBySkill(actor.tenantId, personId, skillIds),
    heldBadges(actor.tenantId, personId),
  ]);
  const awarded: Array<{ id: BadgeAwardId; skillId: SkillId; level: BadgeLevel }> = [];
  const at = yield* now;
  for (const skillId of skillIds) {
    const rows = credits.get(skillId) ?? [];
    const facts = rows.map(toCreditFact);
    for (const level of BADGE_LEVELS) {
      if (badges.some((b) => b.skillId === skillId && b.level === level)) continue;
      const evaluation = evaluateBadge(facts, level, criteria);
      if (!evaluation.met) continue;
      const id = BadgeAwardId.generate();
      const atLevel = rows.filter((r) => r.level >= level);
      const dates = atLevel.map((r) => r.demonstratedOn).toSorted();
      yield* db.insert(schema.badgeAward).values({
        id,
        tenantId: actor.tenantId,
        personId,
        skillId,
        level,
        status: 'awarded',
        awardedAt: at,
        policyVersion: SCORING_POLICY_VERSION,
        triggeringObservationId,
        criteria: {
          thresholds: { ...criteria },
          measured: Object.fromEntries(evaluation.criteria.map((c) => [c.key, c.current])),
          firstDemonstratedOn: dates[0] as IsoDate,
          lastDemonstratedOn: dates.at(-1) as IsoDate,
        },
      });
      // The receipt: exactly which demonstrations earned it.
      yield* db
        .insert(schema.badgeAwardCredit)
        .values(
          atLevel.map((r) => ({ tenantId: actor.tenantId, badgeAwardId: id, creditEntryId: r.id })),
        );
      yield* recordAudit(actor, {
        entityType: 'badge_award',
        entityId: id,
        event: 'AWARD',
        to: 'awarded',
        policyVersion: SCORING_POLICY_VERSION,
        data: {
          personId,
          skillId,
          level,
          criteria: evaluation.criteria.map((c) => `${c.key}:${c.current}/${c.required}`),
        },
      });
      awarded.push({ id, skillId, level });
    }
  }
  return awarded;
});

/**
 * Transaction-scoped advisory lock on one person's ledger. SIGN and VOID take it
 * first so badge evaluation always sees every concurrent credit.
 */
export const lockPersonLedger = Effect.fn('credits.lock')(function* (
  tenantId: TenantId,
  personId: PersonId,
) {
  const db = yield* Db;
  yield* db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${personId}`}, 0))`,
  );
});
