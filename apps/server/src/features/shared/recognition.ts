import { Conflict, Unprocessable, type Actor, type ProgressView } from '@repo/api';
import {
  BADGE_LEVELS,
  BadgeAwardId,
  LEVEL_NAMES,
  badgeCriteriaFor,
  creditPolicyVersion,
  evaluateBadge,
  nextBadgeLevel,
  nextStepSentence,
  readStoredCreditPolicy,
  replaceCreditPolicy,
  roleValues,
  type BadgeLevel,
  type CreditFact,
  type CreditPolicy,
  type CreditRole,
  type PolicyProblem,
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
import { Data, Effect } from 'effect';
import { now } from '../../platform/time.ts';
import { recordAudit } from './audit.ts';
import { loadSkills, toSkillRef } from './skills.ts';

/**
 * A tenant whose stored credit policy is missing or invalid. Signing and every
 * policy-dependent read stop on it (a defect, so a 500) rather than run on
 * values nobody chose; the administration screen reads the problems through
 * `inspectTenantCreditPolicy` and repairs it with `saveCreditPolicy`.
 */
export class CreditPolicyConfigurationError extends Data.TaggedError(
  'CreditPolicyConfigurationError',
)<{
  readonly tenantId: TenantId;
  readonly problems: ReadonlyArray<PolicyProblem>;
}> {
  override get message() {
    return `The credit policy of tenant ${this.tenantId} is not valid (${this.problems
      .map((p) => p.field)
      .join(', ')}); a program owner must repair it.`;
  }
}

/** The stored policy exactly as stored, valid or not, with its problems (for administration). */
export const inspectTenantCreditPolicy = Effect.fn('tenant.inspectCreditPolicy')(function* (
  tenantId: TenantId,
) {
  const db = yield* Db;
  const [row] = yield* db
    .select({ settings: schema.tenant.settings })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, tenantId));
  const raw: unknown = row?.settings.creditPolicy;
  const reading = readStoredCreditPolicy(raw);
  const rawVersion =
    raw !== null && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined;
  return {
    reading,
    /** The version a save must name: the stored one when valid, else 0. */
    version:
      Number.isInteger(rawVersion) && (rawVersion as number) >= 1 ? (rawVersion as number) : 0,
    /** Exactly what is stored, for the compare-and-set. */
    rawVersion: rawVersion === undefined ? null : rawVersion,
  };
});

/** The tenant's credit policy, exactly as stored; dies with `CreditPolicyConfigurationError` if broken. */
export const tenantCreditPolicy = Effect.fn('tenant.creditPolicy')(function* (tenantId: TenantId) {
  const { reading } = yield* inspectTenantCreditPolicy(tenantId);
  if (!reading.ok) {
    return yield* Effect.die(
      new CreditPolicyConfigurationError({ tenantId, problems: reading.problems }),
    );
  }
  return reading.policy;
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
  id: row.id,
  interactionId: row.interactionId,
  observerId: row.observerId,
  level: row.level as Level,
  mode: row.mode as ObservationMode,
  demonstratedOn: row.demonstratedOn,
  points: row.points,
  role: row.role as CreditRole,
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
  const [policy, credits, badges, skills] = yield* Effect.all([
    tenantCreditPolicy(tenantId),
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
    const evaluation = evaluateBadge(facts, target ?? 3, badgeCriteriaFor(policy, skill));
    const values = roleValues(policy, skill);
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
        points: evaluation.points,
        pointsRequired: evaluation.required.badgePoints,
        pointsPerObservation: values,
        criteria: target ? evaluation.criteria : [],
        nextStep: target
          ? nextStepSentence(evaluation, skill.name, values)
          : `You hold every badge for ${skill.name}.`,
        lastDemonstratedOn: lastOn,
      },
    ];
  });
});

/**
 * Evaluates badge criteria under `policy` (the current one, read once by the
 * caller inside its transaction after the ledger lock) for the given skills
 * and awards any newly met badges. Runs inside the signing transaction (or a
 * void's re-award); every input was human-signed. Each award saves the
 * resolved criteria it was judged by, so a later void is judged by the same
 * thresholds. `only` limits the levels considered; `triggeringObservationId`
 * defaults to the observation of the latest net credit for the skill.
 */
export const awardEarnedBadges = Effect.fn('badges.award')(function* (
  actor: Actor,
  policy: CreditPolicy,
  personId: PersonId,
  skillIds: ReadonlyArray<SkillId>,
  triggeringObservationId?: ObservationId,
  only?: ReadonlyArray<{ readonly skillId: SkillId; readonly level: BadgeLevel }>,
) {
  const db = yield* Db;
  const [credits, badges, skills] = yield* Effect.all([
    netCreditsBySkill(actor.tenantId, personId, skillIds),
    heldBadges(actor.tenantId, personId),
    loadSkills(actor.tenantId, skillIds),
  ]);
  const policyVersion = creditPolicyVersion(policy);
  const awarded: Array<{ id: BadgeAwardId; skillId: SkillId; level: BadgeLevel }> = [];
  const at = yield* now;
  for (const skillId of skillIds) {
    const rows = credits.get(skillId) ?? [];
    const facts = rows.map(toCreditFact);
    const criteria = badgeCriteriaFor(policy, skills.get(skillId));
    for (const level of BADGE_LEVELS) {
      if (badges.some((b) => b.skillId === skillId && b.level === level)) continue;
      if (only && !only.some((o) => o.skillId === skillId && o.level === level)) continue;
      const evaluation = evaluateBadge(facts, level, criteria);
      if (!evaluation.met) continue;
      const id = BadgeAwardId.generate();
      const atLevel = rows.filter((r) => r.level >= level);
      const latest = atLevel.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const trigger = triggeringObservationId ?? latest?.observationId;
      if (!trigger) return yield* Effect.die('invariant: a met badge without credits');
      yield* db.insert(schema.badgeAward).values({
        id,
        tenantId: actor.tenantId,
        personId,
        skillId,
        level,
        status: 'awarded',
        awardedAt: at,
        policyVersion,
        triggeringObservationId: trigger,
        criteria: {
          thresholds: { ...criteria },
          measured: {
            ...Object.fromEntries(evaluation.criteria.map((c) => [c.key, c.current])),
            demonstrations: evaluation.demonstrations,
          },
          firstDemonstratedOn: evaluation.work[0]?.on as IsoDate,
          lastDemonstratedOn: evaluation.work.at(-1)?.on as IsoDate,
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
        policyVersion,
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

/**
 * Replaces the tenant's credit policy, compared and set on its stored version
 * (design §2): a stale editor gets `Conflict`, an invalid policy
 * `Unprocessable`; the stored policy is always complete and the version bumps.
 * A broken stored policy can be repaired (its version reads as 0). The caller
 * audits it (before and after, with a reason) in the same transaction. It never
 * re-evaluates or awards anything.
 */
export const saveCreditPolicy = Effect.fn('tenant.saveCreditPolicy')(function* (
  tenantId: TenantId,
  expectedVersion: number,
  proposed: Omit<CreditPolicy, 'version'>,
) {
  const db = yield* Db;
  const { reading, version, rawVersion } = yield* inspectTenantCreditPolicy(tenantId);
  const change = replaceCreditPolicy(version, expectedVersion, proposed);
  const stale = new Conflict({
    message: 'The credit policy changed since you opened it. Reload to continue.',
  });
  if (!change.ok) {
    return yield* Effect.fail(
      change.reason === 'stale'
        ? stale
        : new Unprocessable({
            message: change.problems[0]?.message ?? 'Check the values.',
            field: change.problems[0]?.field ?? 'creditPolicy',
          }),
    );
  }
  const after = change.policy;
  // Set only if the stored version is still exactly what was read.
  const [updated] = yield* db
    .update(schema.tenant)
    .set({
      settings: sql`jsonb_set(${schema.tenant.settings}, '{creditPolicy}', ${JSON.stringify(after)}::jsonb)`,
    })
    .where(
      and(
        eq(schema.tenant.id, tenantId),
        sql`coalesce(${schema.tenant.settings} -> 'creditPolicy' -> 'version', 'null'::jsonb) = ${JSON.stringify(rawVersion)}::jsonb`,
      ),
    )
    .returning({ id: schema.tenant.id });
  if (!updated) return yield* Effect.fail(stale);
  return { before: reading, after };
});
