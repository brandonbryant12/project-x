import * as Domain from '@alchemy.run/domain';
import { Context, DateTime } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  InteractionId,
  ObservationId,
  PersonId,
  SkillId,
  SkillVersionId,
  TenantId,
  type IsoDate,
} from '../ids.ts';
import { ALL_LIFECYCLES } from '../lifecycles/index.ts';
import {
  ObservationLifecycle,
  type ObservationEvent,
  type ObservationFacts,
} from '../lifecycles/observation.ts';
import {
  DEFAULT_BADGE_CRITERIA,
  STRICT_BADGE_CRITERIA,
  evaluateBadge,
  type BadgeCriteriaConfig,
  type CreditFact,
} from '../scoring/badges.ts';
import { BADGE_LEVELS, OBSERVATION_MODES, type Level } from '../vocabulary.ts';
import { CoachingModel } from '../model/Coaching.model.ts';
import { CoachingActor, personActor } from '../model/CoachingActor.context.ts';
import { Observation } from '../model/Observation.aggregate.ts';
import { SignObservation, StartObservation } from '../model/Observation.commands.ts';
import { skillLedgerId, type SkillLedgerId } from '../model/Shared.ts';
import {
  RecordDemonstration,
  ReverseDemonstration,
  SkillLedger,
  type SkillLedgerState,
} from '../model/SkillLedger.aggregate.ts';

/** Deterministic xorshift32 PRNG for reproducible property-based formal checks. */
const makePrng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
};

interface RawStateConfig {
  readonly type?: string;
  readonly on?: Readonly<
    Record<string, string | { readonly target?: string; readonly guard?: string }>
  >;
}

const edgesOf = (lifecycle: (typeof ALL_LIFECYCLES)[number]) => {
  const cfg = lifecycle.machine.config as {
    readonly states?: Readonly<Record<string, RawStateConfig>>;
  };
  const adj = new Map<string, Set<string>>();
  for (const s of lifecycle.states) adj.set(s, new Set());
  for (const [from, def] of Object.entries(cfg.states ?? {})) {
    for (const transition of Object.values(def.on ?? {})) {
      const target = (
        typeof transition === 'string' ? transition : (transition.target ?? from)
      ).replace(/^\./, '');
      adj.get(from)?.add(target);
    }
  }
  return adj;
};

const reachableFrom = (starts: ReadonlyArray<string>, adj: ReadonlyMap<string, Set<string>>) => {
  const visited = new Set<string>(starts);
  const queue: Array<string> = [...starts];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of adj.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
};

interface DemoSample {
  readonly obsId: ObservationId;
  readonly intId: InteractionId;
  readonly observerId: PersonId;
  readonly level: Level;
  readonly mode: (typeof OBSERVATION_MODES)[number];
  readonly date: IsoDate;
}

const runLedgerTrial = (args: {
  readonly trial: number;
  readonly rand: () => number;
  readonly ledgerId: SkillLedgerId;
  readonly criteria: BadgeCriteriaConfig;
  readonly observers: ReadonlyArray<PersonId>;
  readonly dates: ReadonlyArray<IsoDate>;
  readonly fixedNow: DateTime.Utc;
}): ReadonlyArray<string> => {
  const { trial, rand, ledgerId, criteria, observers, dates, fixedNow } = args;
  const violations: Array<string> = [];
  let state: SkillLedgerState = { demonstrations: [], heldBadges: [] };
  const pool: Array<DemoSample> = [];
  const activeIds = new Set<ObservationId>();

  const steps = 10 + Math.floor(rand() * 12);
  for (let step = 0; step < steps; step++) {
    const prevBadges = state.heldBadges;
    const isRecord = rand() < 0.65 || pool.length === 0;
    if (isRecord) {
      const replay = pool.length > 0 && rand() < 0.25;
      const entry = replay
        ? pool[Math.floor(rand() * pool.length)]!
        : {
            obsId: ObservationId.generate(),
            intId: InteractionId.generate(),
            observerId: observers[Math.floor(rand() * observers.length)]!,
            level: ([1, 2, 3, 4] as const)[Math.floor(rand() * 4)]!,
            mode: OBSERVATION_MODES[Math.floor(rand() * OBSERVATION_MODES.length)]!,
            date: dates[Math.floor(rand() * dates.length)]!,
          };
      if (!replay) pool.push(entry);
      const pred = SkillLedger.predict(
        state,
        new RecordDemonstration({
          observationId: entry.obsId,
          interactionId: entry.intId,
          observerId: entry.observerId,
          level: entry.level,
          mode: entry.mode,
          demonstratedOn: entry.date,
          criteria,
        }),
        { id: ledgerId, now: fixedNow },
      );
      if (pred._tag !== 'Accepted') {
        violations.push(`trial ${trial} step ${step}: RecordDemonstration returned ${pred._tag}`);
        break;
      }
      if (activeIds.has(entry.obsId) && pred.events.length > 0) {
        violations.push(`trial ${trial} step ${step}: duplicate record was not idempotent`);
      }
      activeIds.add(entry.obsId);
      state = pred.state;
    } else {
      const entry = pool[Math.floor(rand() * pool.length)]!;
      const pred = SkillLedger.predict(
        state,
        new ReverseDemonstration({
          observationId: entry.obsId,
          reasonCode: 'observation_voided',
          criteria,
        }),
        { id: ledgerId, now: fixedNow },
      );
      if (pred._tag !== 'Accepted') {
        violations.push(`trial ${trial} step ${step}: ReverseDemonstration returned ${pred._tag}`);
        break;
      }
      if (!activeIds.has(entry.obsId) && pred.events.length > 0) {
        violations.push(`trial ${trial} step ${step}: duplicate reversal was not idempotent`);
      }
      activeIds.delete(entry.obsId);
      state = pred.state;
    }

    if (state.demonstrations.length !== activeIds.size) {
      violations.push(`trial ${trial} step ${step}: credit conservation violated`);
    }
    const facts: ReadonlyArray<CreditFact> = state.demonstrations.map((d) => ({
      interactionId: d.interactionId as InteractionId,
      observerId: d.observerId,
      level: d.level,
      mode: d.mode,
      demonstratedOn: d.demonstratedOn,
    }));
    const metNow = BADGE_LEVELS.filter((lvl) => evaluateBadge(facts, lvl, criteria).met);
    for (const lvl of metNow) {
      if (!state.heldBadges.includes(lvl)) {
        violations.push(`trial ${trial} step ${step}: met badge L${lvl} not awarded`);
      }
    }
    if (isRecord) {
      for (const prev of prevBadges) {
        if (!state.heldBadges.includes(prev)) {
          violations.push(`trial ${trial} step ${step}: recording penalized earned badge L${prev}`);
        }
      }
    } else if (activeIds.size === 0 && state.heldBadges.length > 0) {
      violations.push(`trial ${trial} step ${step}: badges remained after all credits voided`);
    }

    const defaultSet = new Set(
      BADGE_LEVELS.filter((lvl) => evaluateBadge(facts, lvl, DEFAULT_BADGE_CRITERIA).met),
    );
    for (const lvl of BADGE_LEVELS) {
      if (evaluateBadge(facts, lvl, STRICT_BADGE_CRITERIA).met && !defaultSet.has(lvl)) {
        violations.push(`trial ${trial} step ${step}: strict policy not monotonic wrt default`);
      }
    }
  }

  return violations;
};

describe('Formal verification — state-space & algebraic invariants', () => {
  it('verifies CoachingModel structural graph via Domain.verify', () => {
    expect(Domain.verify(CoachingModel)).toEqual([]);
  });

  it('proves reachability, terminal absorption, and deadlock-freedom across ALL_LIFECYCLES via BFS', () => {
    const violations: Array<string> = [];
    for (const lifecycle of ALL_LIFECYCLES) {
      const adj = edgesOf(lifecycle);
      const reachable = reachableFrom(lifecycle.initialStates, adj);
      for (const state of lifecycle.states) {
        if (!reachable.has(state)) violations.push(`${lifecycle.name}: unreachable ${state}`);
      }
      for (const term of lifecycle.terminalStates) {
        if ((adj.get(term)?.size ?? 0) > 0) {
          violations.push(`${lifecycle.name}: terminal ${term} has outgoing transitions`);
        }
      }
      const targets =
        lifecycle.terminalStates.length > 0 ? lifecycle.terminalStates : ['available'];
      for (const state of lifecycle.states) {
        const canReach = reachableFrom([state], adj);
        if (!targets.some((t) => canReach.has(t))) {
          violations.push(`${lifecycle.name}: deadlock state ${state}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('proves privacy safety invariant: privacyHold=true ⇒ SIGN is impossible across all reachable states', () => {
    const combinations: Array<ObservationFacts> = [false, true].flatMap((ratingsComplete) =>
      [0, 9, 10, 80].flatMap((narrativeLength) =>
        [false, true].map((acknowledged) => ({
          ratingsComplete,
          narrativeLength,
          privacyHold: true,
          acknowledged,
        })),
      ),
    );
    const breaches = ObservationLifecycle.states.flatMap((status) =>
      combinations
        .filter((facts) => ObservationLifecycle.next(status, facts, { type: 'SIGN' }) !== null)
        .map((facts) => `${status}/${facts.ratingsComplete}/${facts.narrativeLength}`),
    );
    expect(breaches).toEqual([]);
  });

  it('proves credit authority invariant: only SIGN enters signed from unsigned; only VOID enters voided', () => {
    const allEvents: ReadonlyArray<ObservationEvent> = ObservationLifecycle.events.map((type) => ({
      type,
    }));
    const fullFacts: ObservationFacts = {
      ratingsComplete: true,
      narrativeLength: 50,
      privacyHold: false,
      acknowledged: false,
    };
    const violations: Array<string> = [];
    for (const from of ObservationLifecycle.states) {
      for (const ev of allEvents) {
        const to = ObservationLifecycle.next(from, fullFacts, ev);
        if (to === 'signed' && from !== 'signed' && from !== 'under_review' && ev.type !== 'SIGN') {
          violations.push(`${from} --${ev.type}--> signed`);
        }
        if (to === 'voided' && ev.type !== 'VOID') {
          violations.push(`${from} --${ev.type}--> voided`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('proves credit conservation, idempotency, and badge soundness over 250 randomized SkillLedger histories', () => {
    const rand = makePrng(0xc0a_c417);
    const fixedNow = DateTime.makeUnsafe('2026-11-22T12:00:00Z');
    const ledgerId = skillLedgerId(TenantId.generate(), PersonId.generate(), SkillId.generate());
    const observers = [PersonId.generate(), PersonId.generate(), PersonId.generate()];
    const dates: ReadonlyArray<IsoDate> = [
      '2026-09-01' as IsoDate,
      '2026-09-10' as IsoDate,
      '2026-09-20' as IsoDate,
      '2026-10-05' as IsoDate,
      '2026-10-20' as IsoDate,
    ];
    const allViolations: Array<string> = [];
    for (let trial = 0; trial < 250; trial++) {
      const criteria = trial % 2 === 0 ? DEFAULT_BADGE_CRITERIA : STRICT_BADGE_CRITERIA;
      allViolations.push(
        ...runLedgerTrial({ trial, rand, ledgerId, criteria, observers, dates, fixedNow }),
      );
    }
    expect(allViolations).toEqual([]);
  });

  it('proves immutable Observation events never store raw narrative PII text (ADR 0015)', () => {
    const fixedNow = DateTime.makeUnsafe('2026-11-22T12:00:00Z');
    const tenant = TenantId.generate();
    const subject = PersonId.generate();
    const observer = PersonId.generate();
    const skill = SkillId.generate();
    const skillVer = SkillVersionId.generate();
    const obsId = ObservationId.generate();
    const secretNarrative = 'Unique sentinel narrative phrase that must never enter event JSON.';
    const observerCtx = Context.make(CoachingActor, personActor(tenant, observer));

    const started = Observation.predict(
      { _tag: 'Uncreated' },
      new StartObservation({
        subjectId: subject,
        interactionId: InteractionId.generate(),
        occurredOn: '2026-11-15' as IsoDate,
        basis: 'leader',
        mode: 'saw_it',
        skillIds: [skill],
      }),
      { id: obsId, now: fixedNow, context: observerCtx },
    );
    expect(started._tag).toBe('Accepted');

    const signed = Observation.predict(
      started._tag === 'Accepted' ? started.state : { _tag: 'Uncreated' },
      new SignObservation({
        mode: 'saw_it',
        ratings: [
          { skillId: skill, skillVersionId: skillVer, level: 3, credit: true, indicatorIds: [] },
        ],
        narrativeSaw: secretNarrative,
        narrativeNext: 'Try asking one follow-up.',
        contentDigest: 'sha256-digest-only',
      }),
      { id: obsId, now: fixedNow, context: observerCtx },
    );
    expect(signed._tag).toBe('Accepted');

    const serializedEvents = JSON.stringify([
      ...(started._tag === 'Accepted' ? started.events : []),
      ...(signed._tag === 'Accepted' ? signed.events : []),
    ]);
    expect(serializedEvents).not.toContain(secretNarrative);
    expect(serializedEvents).toContain('sha256-digest-only');
  });
});
