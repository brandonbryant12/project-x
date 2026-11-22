import * as Domain from '@alchemy.run/domain';
import { Schema } from 'effect';
import { InteractionId, IsoDate, ObservationId, PersonId, SkillId, TenantId } from '../ids.ts';
import { evaluateBadge, type CreditFact } from '../scoring/badges.ts';
import { BADGE_LEVELS, Level, ObservationMode, type BadgeLevel } from '../vocabulary.ts';
import {
  BadgeCriteriaFact,
  DemonstrationFact,
  parseSkillLedgerId,
  SkillLedgerId,
} from './Shared.ts';

/* ── Raw Fact Events + Derived Badge Lifecycle Facts ── */

export class DemonstrationRecorded extends Domain.Event('DemonstrationRecorded', {
  tenantId: TenantId,
  personId: PersonId,
  skillId: SkillId,
  observationId: ObservationId,
  interactionId: InteractionId,
  observerId: PersonId,
  level: Level,
  mode: ObservationMode,
  demonstratedOn: IsoDate,
}) {}

export class DemonstrationReversed extends Domain.Event('DemonstrationReversed', {
  tenantId: TenantId,
  personId: PersonId,
  skillId: SkillId,
  observationId: ObservationId,
  reasonCode: Schema.String,
}) {}

export class BadgeAwarded extends Domain.Event('BadgeAwarded', {
  tenantId: TenantId,
  personId: PersonId,
  skillId: SkillId,
  level: Schema.Literals(BADGE_LEVELS),
  triggerObservationId: Schema.NullOr(ObservationId),
}) {}

export class BadgeRevoked extends Domain.Event('BadgeRevoked', {
  tenantId: TenantId,
  personId: PersonId,
  skillId: SkillId,
  level: Schema.Literals(BADGE_LEVELS),
  triggerObservationId: Schema.NullOr(ObservationId),
}) {}

/* ── Commands ── */

export class RecordDemonstration extends Domain.Command(
  'RecordDemonstration',
  {
    target: SkillLedgerId,
    input: {
      observationId: ObservationId,
      interactionId: InteractionId,
      observerId: PersonId,
      level: Level,
      mode: ObservationMode,
      demonstratedOn: IsoDate,
      criteria: BadgeCriteriaFact,
    },
    events: [DemonstrationRecorded, BadgeAwarded],
    rejects: [],
    reply: { awardedLevels: Schema.Array(Schema.Literals(BADGE_LEVELS)) },
  },
  {
    description:
      'Record one raw signed skill demonstration and award any newly satisfied badge levels.',
  },
) {}

export class ReverseDemonstration extends Domain.Command(
  'ReverseDemonstration',
  {
    target: SkillLedgerId,
    input: {
      observationId: ObservationId,
      reasonCode: Schema.String,
      criteria: BadgeCriteriaFact,
    },
    events: [DemonstrationReversed, BadgeAwarded, BadgeRevoked],
    rejects: [],
    reply: { revokedLevels: Schema.Array(Schema.Literals(BADGE_LEVELS)) },
  },
  {
    description:
      'Reverse credit from a voided observation and reconcile badges (revoking unmet or awarding newly satisfied levels).',
  },
) {}

export class ReevaluateStanding extends Domain.Command(
  'ReevaluateStanding',
  {
    target: SkillLedgerId,
    input: {
      criteria: BadgeCriteriaFact,
      /** When false (default), previously awarded badges are grandfathered on tightening. */
      revokeUnmet: Schema.Boolean,
    },
    events: [BadgeAwarded, BadgeRevoked],
    rejects: [],
  },
  {
    description:
      'Re-evaluate badge standing against updated policy criteria using stored raw demonstration facts.',
  },
) {}

export const SkillLedgerState = Schema.Struct({
  demonstrations: Schema.Array(DemonstrationFact),
  heldBadges: Schema.Array(Schema.Literals(BADGE_LEVELS)),
});
export type SkillLedgerState = typeof SkillLedgerState.Type;

const toCreditFacts = (demos: ReadonlyArray<DemonstrationFact>): ReadonlyArray<CreditFact> =>
  demos.map((d) => ({
    interactionId: d.interactionId as InteractionId,
    observerId: d.observerId,
    level: d.level,
    mode: d.mode,
    demonstratedOn: d.demonstratedOn,
  }));

/**
 * Per-(tenant, person, skill) consistency boundary for mastery credit & badges.
 * Stores raw `DemonstrationFact` records so future scoring/badge-criteria changes
 * can replay or re-evaluate cleanly without mutating historical events.
 */
export class SkillLedger extends Domain.Aggregate(
  'SkillLedger',
  {
    id: SkillLedgerId,
    state: SkillLedgerState,
    initial: { demonstrations: [], heldBadges: [] },
    commands: [RecordDemonstration, ReverseDemonstration, ReevaluateStanding],
    decide: {
      RecordDemonstration: (state, cmd, ctx) => {
        // Idempotent: ignore duplicate recording of the same signed observation.
        if (state.demonstrations.some((d) => d.observationId === cmd.observationId)) return [];
        const { tenantId, personId, skillId } = parseSkillLedgerId(ctx.id);
        const recorded = new DemonstrationRecorded({
          tenantId,
          personId,
          skillId,
          observationId: cmd.observationId,
          interactionId: cmd.interactionId,
          observerId: cmd.observerId,
          level: cmd.level,
          mode: cmd.mode,
          demonstratedOn: cmd.demonstratedOn,
        });
        const nextDemos: ReadonlyArray<DemonstrationFact> = [
          ...state.demonstrations,
          {
            observationId: cmd.observationId,
            interactionId: cmd.interactionId,
            observerId: cmd.observerId,
            level: cmd.level,
            mode: cmd.mode,
            demonstratedOn: cmd.demonstratedOn,
          },
        ];
        const facts = toCreditFacts(nextDemos);
        const awarded = BADGE_LEVELS.filter(
          (lvl) => !state.heldBadges.includes(lvl) && evaluateBadge(facts, lvl, cmd.criteria).met,
        ).map(
          (level) =>
            new BadgeAwarded({
              tenantId,
              personId,
              skillId,
              level,
              triggerObservationId: cmd.observationId,
            }),
        );
        return [recorded, ...awarded];
      },
      ReverseDemonstration: (state, cmd, ctx) => {
        // Idempotent: if this observation is not active in the ledger, nothing to reverse.
        if (!state.demonstrations.some((d) => d.observationId === cmd.observationId)) return [];
        const { tenantId, personId, skillId } = parseSkillLedgerId(ctx.id);
        const reversed = new DemonstrationReversed({
          tenantId,
          personId,
          skillId,
          observationId: cmd.observationId,
          reasonCode: cmd.reasonCode,
        });
        const remaining = state.demonstrations.filter((d) => d.observationId !== cmd.observationId);
        const facts = toCreditFacts(remaining);
        const awarded = BADGE_LEVELS.filter(
          (lvl) => !state.heldBadges.includes(lvl) && evaluateBadge(facts, lvl, cmd.criteria).met,
        ).map(
          (level) =>
            new BadgeAwarded({
              tenantId,
              personId,
              skillId,
              level,
              triggerObservationId: cmd.observationId,
            }),
        );
        const revoked = state.heldBadges
          .filter((lvl) => !evaluateBadge(facts, lvl, cmd.criteria).met)
          .map(
            (level) =>
              new BadgeRevoked({
                tenantId,
                personId,
                skillId,
                level,
                triggerObservationId: cmd.observationId,
              }),
          );
        return [reversed, ...awarded, ...revoked];
      },
      ReevaluateStanding: (state, cmd, ctx) => {
        const { tenantId, personId, skillId } = parseSkillLedgerId(ctx.id);
        const facts = toCreditFacts(state.demonstrations);
        const awarded = BADGE_LEVELS.filter(
          (lvl) => !state.heldBadges.includes(lvl) && evaluateBadge(facts, lvl, cmd.criteria).met,
        ).map(
          (level) =>
            new BadgeAwarded({ tenantId, personId, skillId, level, triggerObservationId: null }),
        );
        const revoked = cmd.revokeUnmet
          ? state.heldBadges
              .filter((lvl) => !evaluateBadge(facts, lvl, cmd.criteria).met)
              .map(
                (level) =>
                  new BadgeRevoked({
                    tenantId,
                    personId,
                    skillId,
                    level,
                    triggerObservationId: null,
                  }),
              )
          : [];
        return [...awarded, ...revoked];
      },
    },
    evolve: {
      DemonstrationRecorded: (state, e) => ({
        ...state,
        demonstrations: [
          ...state.demonstrations,
          {
            observationId: e.observationId,
            interactionId: e.interactionId,
            observerId: e.observerId,
            level: e.level,
            mode: e.mode,
            demonstratedOn: e.demonstratedOn,
          },
        ],
      }),
      DemonstrationReversed: (state, e) => ({
        ...state,
        demonstrations: state.demonstrations.filter((d) => d.observationId !== e.observationId),
      }),
      BadgeAwarded: (state, e) => ({
        ...state,
        heldBadges: state.heldBadges.includes(e.level)
          ? state.heldBadges
          : ([...state.heldBadges, e.level].toSorted((a, b) => a - b) as Array<BadgeLevel>),
      }),
      BadgeRevoked: (state, e) => ({
        ...state,
        heldBadges: state.heldBadges.filter((lvl) => lvl !== e.level),
      }),
    },
    reply: {
      RecordDemonstration: (_state, events) => ({
        awardedLevels: events
          .filter((e): e is BadgeAwarded => e._tag === 'BadgeAwarded')
          .map((e) => e.level),
      }),
      ReverseDemonstration: (_state, events) => ({
        revokedLevels: events
          .filter((e): e is BadgeRevoked => e._tag === 'BadgeRevoked')
          .map((e) => e.level),
      }),
    },
  },
  {
    description:
      'Double-entry skill demonstration ledger & badge evaluator for one (tenant, person, skill).',
  },
) {}
