import {
  Decisions,
  DecisionsFailed,
  type DecisionAnswer,
  type DecisionRequest,
  type DecisionsService,
} from '@repo/ai';
import { CurrentActor, type Actor } from '@repo/api';
import type { EvidenceId, InteractionId, IsoDate } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { Effect, Option, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { logInteraction, reviseEvidence } from '../features/development/use-cases.ts';
import { screenEvidenceWithAssistant } from '../features/shared/advisory/evidence-screening.ts';
import { privacyScreen } from '../features/shared/advisory/question-sets.ts';
import { runCheck } from '../features/shared/advisory/runner.ts';
import { Background } from '../platform/background.ts';
import { now } from '../platform/time.ts';
import {
  MAX_SCREEN_ATTEMPTS,
  RETRY_AFTER_MS,
  SCREEN_GRACE_MS,
  SCREEN_LOOKBACK_MS,
  runScreeningSweep,
} from '../scheduler/screening.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, TestSession, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: the boundary in front of the assistant screen (ADR 0008, 0012).
 * Protects I7 at the provider boundary: text the local screen holds is never
 * sent to a model, whoever asks, and an available reflection the local rules
 * now hold is held by them. Protects the recovery of missed screens: a
 * reflection whose after-commit screen never ran is screened by the sweep,
 * once per version, within a bounded look-back, a bounded number of times,
 * and not at all while the assistant is off. A failure is never a pass.
 */
const MINUTE = 60_000;

const spy = (answer: 'clean' | 'fail') =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<ReadonlyArray<string>>([]);
    const service: DecisionsService = {
      availability: { enabled: true, provider: 'mock', model: 'spy' },
      evaluate: (request: DecisionRequest) =>
        Effect.gen(function* () {
          const text = request.input.flatMap((part) => (part.type === 'text' ? [part.text] : []));
          yield* Ref.update(seen, (all) => [...all, ...text]);
          if (answer === 'fail') {
            return yield* Effect.fail(
              new DecisionsFailed({ outcome: 'unknown', status: null, message: 'down' }),
            );
          }
          const answers: Record<string, DecisionAnswer> = Object.fromEntries(
            Object.keys(request.questions).map((key) => [
              key,
              { kind: 'binary', probability: 0.01, confidence: 0.9 } satisfies DecisionAnswer,
            ]),
          );
          return {
            model: 'spy',
            answers,
            missing: [],
            malformed: [],
            inputTokens: 1,
            costUsdMicros: 0,
            latencyMs: 0,
          };
        }),
    };
    const sentWith = (marker: string) =>
      Ref.get(seen).pipe(Effect.map((all) => all.filter((t) => t.includes(marker)).length));
    return { service, sentWith };
  });

const disabled: DecisionsService = {
  availability: { enabled: false, provider: 'disabled', model: null },
  evaluate: () => Effect.die('the assistant is off'),
};

/** The process stopped between the commit and the after-commit screen. */
const lostAfterCommit = Background.of({ run: () => Effect.void });

const mayaActor = Effect.gen(function* () {
  yield* signInAs('Maya Chen');
  return Option.getOrThrow(yield* Ref.get(yield* TestSession)) as Actor;
});

const evidenceOf = (interactionId: InteractionId) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [row] = yield* db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.interactionId, interactionId));
    assert.isDefined(row);
    return row;
  });

const checksOn = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db
      .select()
      .from(schema.advisoryCheck)
      .where(eq(schema.advisoryCheck.subjectId, id));
  });

/** Logs work whose after-commit screen is lost, through the real use case. */
const logMissingItsScreen = (reflection: string) =>
  Effect.gen(function* () {
    const actor = yield* mayaActor;
    const db = yield* Db;
    const interactionId = yield* logInteraction({
      activityId: null,
      adHocTitle: 'Annual review',
      adHocSkillIds: [],
      occurredOn: '2026-11-13' as IsoDate,
      kind: 'client_meeting',
      clientRef: null,
      reflection,
    }).pipe(
      Effect.provideService(CurrentActor, actor),
      Effect.provideService(Background, lostAfterCommit),
    );
    // The database stamps a new reflection with its own (wall) clock; put it on the test clock.
    const evidence = yield* evidenceOf(interactionId);
    yield* db
      .update(schema.evidence)
      .set({ updatedAt: yield* now })
      .where(eq(schema.evidence.id, evidence.id));
    assert.strictEqual(evidence.status, 'available');
    return { actor, interactionId, evidenceId: evidence.id as EvidenceId };
  });

const sweepWith = (service: DecisionsService) =>
  runScreeningSweep().pipe(Effect.provideService(Decisions, service));

layer(ScenarioLayer, { timeout: 60_000 })('assistant screen boundary', (it) => {
  it.effect('I7: held text never reaches the provider, whoever calls the check', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const db = yield* Db;
      const provider = yield* spy('clean');

      // Any caller: the boundary re-runs the local screen on the exact text.
      const actor = yield* mayaActor;
      const built = privacyScreen.build();
      const outcome = yield* runCheck({
        actor,
        questionSet: privacyScreen,
        built,
        subjectType: 'observation',
        subjectId: 'obs_boundary0000000',
        subjectVersion: 1,
        text: 'Marker-one: his SSN is 123-45-6789, noted for the file.',
        interpret: (result) => privacyScreen.interpret(result.answers, built.thresholds),
      }).pipe(Effect.provideService(Decisions, provider.service));
      assert.strictEqual(outcome.status, 'skipped');
      assert.strictEqual(yield* provider.sentWith('Marker-one'), 0);
      const [skipped] = yield* checksOn('obs_boundary0000000');
      assert.deepStrictEqual([skipped?.status, skipped?.provider], ['skipped', 'local']);

      // An available reflection the local rules now hold (a rule added since it was
      // written): it is not sent, and the local rule holds it, audited as a system hold.
      const { evidenceId } = yield* logMissingItsScreen(
        'Marker-two: walked the household through the plan step by step.',
      );
      yield* db
        .update(schema.evidence)
        .set({ body: 'Marker-two: the client wrote from jo.client@example.com about the plan.' })
        .where(eq(schema.evidence.id, evidenceId));
      yield* screenEvidenceWithAssistant(actor, evidenceId).pipe(
        Effect.provideService(Decisions, provider.service),
      );
      assert.strictEqual(yield* provider.sentWith('Marker-two'), 0);
      const [held] = yield* db
        .select()
        .from(schema.evidence)
        .where(eq(schema.evidence.id, evidenceId));
      assert.strictEqual(held?.status, 'held');
      assert.match(held?.holdReason ?? '', /email address/);
      const audit = yield* db
        .select()
        .from(schema.auditEvent)
        .where(
          and(eq(schema.auditEvent.entityId, evidenceId), eq(schema.auditEvent.event, 'HOLD')),
        );
      assert.deepStrictEqual(
        audit.map((a) => [a.reasonCode, a.actorId, a.toState]),
        [['privacy_local', null, 'held']],
      );
    }),
  );

  it.effect('the sweep screens a reflection that missed its screen, once per version', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const provider = yield* spy('clean');
      const { evidenceId, interactionId, actor } = yield* logMissingItsScreen(
        'Marker-three: agreed a checkpoint date instead of changing the allocation.',
      );
      assert.lengthOf(yield* checksOn(evidenceId), 0);

      // The after-commit screen gets the first go: nothing within the grace period.
      yield* sweepWith(provider.service);
      assert.strictEqual(yield* provider.sentWith('Marker-three'), 0);

      yield* TestClock.adjust(SCREEN_GRACE_MS + MINUTE);
      yield* sweepWith(provider.service);
      assert.strictEqual(yield* provider.sentWith('Marker-three'), 1);
      const first = yield* evidenceOf(interactionId);
      assert.deepStrictEqual(
        (yield* checksOn(evidenceId)).map((c) => [c.status, c.subjectVersion]),
        [['completed', first.version]],
      );

      // Already checked at its current version: left alone.
      yield* TestClock.adjust(RETRY_AFTER_MS + MINUTE);
      yield* sweepWith(provider.service);
      assert.strictEqual(yield* provider.sentWith('Marker-three'), 1);

      // Revised: the new version is screened again.
      yield* reviseEvidence(
        interactionId,
        'Marker-three revised: agreed a checkpoint date and wrote it down together.',
      ).pipe(
        Effect.provideService(CurrentActor, actor),
        Effect.provideService(Background, lostAfterCommit),
      );
      yield* TestClock.adjust(SCREEN_GRACE_MS + MINUTE);
      yield* sweepWith(provider.service);
      assert.strictEqual(yield* provider.sentWith('Marker-three revised'), 1);
      const revised = yield* evidenceOf(interactionId);
      assert.sameDeepMembers(
        (yield* checksOn(evidenceId)).map((c) => [c.status, c.subjectVersion]),
        [
          ['completed', first.version],
          ['completed', revised.version],
        ],
      );
    }),
  );

  it.effect('a failing provider is retried a bounded number of times and never passes', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const provider = yield* spy('fail');
      const { evidenceId, interactionId } = yield* logMissingItsScreen(
        'Marker-four: explained the fee schedule before the household asked about it.',
      );
      const before = yield* evidenceOf(interactionId);
      yield* TestClock.adjust(SCREEN_GRACE_MS + MINUTE);
      for (let attempt = 1; attempt <= MAX_SCREEN_ATTEMPTS + 1; attempt++) {
        yield* sweepWith(provider.service);
        // Not again before the retry interval.
        yield* sweepWith(provider.service);
        assert.strictEqual(
          yield* provider.sentWith('Marker-four'),
          Math.min(attempt, MAX_SCREEN_ATTEMPTS),
        );
        yield* TestClock.adjust(RETRY_AFTER_MS + MINUTE);
      }
      assert.deepStrictEqual(
        (yield* checksOn(evidenceId)).map((c) => c.status),
        Array.from({ length: MAX_SCREEN_ATTEMPTS }, () => 'failed'),
      );
      const after = yield* evidenceOf(interactionId);
      assert.deepStrictEqual(
        [after.status, after.version, after.holdReason],
        [before.status, before.version, before.holdReason],
      );
    }),
  );

  it.effect('nothing is sent while the assistant is off, nor once a reflection is old', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const provider = yield* spy('clean');
      const { evidenceId } = yield* logMissingItsScreen(
        'Marker-five: let the household set the pace of the conversation.',
      );
      yield* TestClock.adjust(SCREEN_GRACE_MS + MINUTE);
      assert.strictEqual(yield* sweepWith(disabled), 0);
      assert.lengthOf(yield* checksOn(evidenceId), 0);

      // Switching the assistant on later never sends what is older than the look-back.
      yield* TestClock.adjust(SCREEN_LOOKBACK_MS);
      yield* sweepWith(provider.service);
      assert.strictEqual(yield* provider.sentWith('Marker-five'), 0);
      assert.lengthOf(yield* checksOn(evidenceId), 0);
    }),
  );
});
