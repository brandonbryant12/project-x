import {
  Decisions,
  DecisionsFailed,
  type DecisionAnswer,
  type DecisionRequest,
  type DecisionsService,
} from '@repo/ai';
import { Api, type Actor } from '@repo/api';
import type { EvidenceId, IsoDate } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { screenEvidenceWithAssistant } from '../features/shared/advisory/evidence-screening.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: the assistant privacy screen reviews a logged reflection.
 * Protects I5 (a model result never clears, credits or awards): a failed or
 * clean check changes nothing (and is still recorded on advisory_check), held
 * text stays held whatever the model says, and a "hold" holds only the exact
 * version that was screened.
 */
const client = HttpApiTest.groups(Api, ['development']);

const provider = (
  answer: (request: DecisionRequest) => Effect.Effect<Record<string, DecisionAnswer>, unknown>,
): DecisionsService => ({
  availability: { enabled: true, provider: 'mock', model: 'journey-test' },
  evaluate: (request) =>
    answer(request).pipe(
      Effect.map((answers) => ({
        model: 'journey-test',
        answers,
        missing: [],
        malformed: [],
        inputTokens: 1,
        costUsdMicros: 0,
        latencyMs: 0,
      })),
      Effect.catch(() =>
        Effect.fail(new DecisionsFailed({ outcome: 'unknown', status: null, message: 'down' })),
      ),
    ),
});

const everyQuestion = (request: DecisionRequest, probability: number) =>
  Object.fromEntries(
    Object.keys(request.questions).map((key) => [
      key,
      { kind: 'binary', probability, confidence: 0.9 } satisfies DecisionAnswer,
    ]),
  );

const failing = provider(() => Effect.fail('provider unavailable'));
const clean = provider((request) => Effect.succeed(everyQuestion(request, 0.01)));

const screenWith = (service: DecisionsService, actor: Actor, id: EvidenceId) =>
  screenEvidenceWithAssistant(actor, id).pipe(Effect.provideService(Decisions, service));

const evidenceRow = (id: EvidenceId) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [row] = yield* db.select().from(schema.evidence).where(eq(schema.evidence.id, id));
    return row;
  });

const checksOn = (id: EvidenceId) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db
      .select()
      .from(schema.advisoryCheck)
      .where(eq(schema.advisoryCheck.subjectId, id));
  });

const logAs = (name: string, reflection: string) =>
  Effect.gen(function* () {
    const api = yield* client;
    const db = yield* Db;
    const personId = yield* signInAs(name);
    const [person] = yield* db.select().from(schema.person).where(eq(schema.person.id, personId));
    assert.isDefined(person);
    const logged = yield* api.development.logInteraction({
      payload: {
        activityId: null,
        adHocTitle: 'Annual review',
        adHocSkillIds: [],
        occurredOn: '2026-11-13' as IsoDate,
        kind: 'client_meeting',
        clientRef: null,
        reflection,
      },
    });
    const [evidence] = yield* db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.interactionId, logged.id));
    assert.isDefined(evidence);
    const actor: Actor = {
      tenantId: person.tenantId,
      personId,
      displayName: person.displayName,
      grants: [],
    };
    return { actor, evidenceId: evidence.id as EvidenceId };
  });

layer(ScenarioLayer, { timeout: 60_000 })('advisory never clears', (it) => {
  it.effect(
    'I5: the assistant may hold available text; the hold is audited with no human actor',
    () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        yield* seedWorld;
        const db = yield* Db;
        // Passes the local screen; the mock model reads "the Hendersons" as a client name.
        const { evidenceId } = yield* logAs(
          'Maya Chen',
          'Walked the Hendersons through the rebalancing plan and let them set the pace.',
        );
        const held = yield* evidenceRow(evidenceId);
        assert.strictEqual(held?.status, 'held');
        const [check] = (yield* checksOn(evidenceId)).filter((c) => c.status === 'completed');
        assert.strictEqual(check?.effect, 'hold');
        const audit = yield* db
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.entityId, evidenceId),
              eq(schema.auditEvent.event, 'HOLD'),
              isNull(schema.auditEvent.actorId),
            ),
          );
        assert.strictEqual(audit.length, 1);
      }),
  );

  it.effect('I5: a failed or clean check changes nothing, and held text stays held', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const { actor, evidenceId } = yield* logAs(
        'Maya Chen',
        'Explained the fee schedule before the household asked about it.',
      );
      const before = yield* evidenceRow(evidenceId);
      assert.strictEqual(before?.status, 'available');
      // By id, not position: rows come back in heap order, which updates reshuffle on Postgres.
      const checksBefore = new Set((yield* checksOn(evidenceId)).map((c) => c.id));

      yield* screenWith(failing, actor, evidenceId);
      yield* screenWith(clean, actor, evidenceId);
      const after = yield* evidenceRow(evidenceId);
      assert.deepStrictEqual(
        [after?.status, after?.version, after?.holdReason],
        [before?.status, before?.version, before?.holdReason],
      );
      const checks = (yield* checksOn(evidenceId)).filter((c) => !checksBefore.has(c.id));
      assert.sameMembers(
        checks.map((c) => c.status),
        ['failed', 'completed'],
      );

      // Text the local screen held: a clean model answer does not release it.
      const db = yield* Db;
      const [localHold] = yield* db
        .select()
        .from(schema.evidence)
        .where(eq(schema.evidence.status, 'held'));
      assert.isDefined(localHold);
      yield* screenWith(clean, actor, localHold.id as EvidenceId);
      const still = yield* evidenceRow(localHold.id as EvidenceId);
      assert.deepStrictEqual(
        [still?.status, still?.version],
        [localHold.status, localHold.version],
      );
    }),
  );

  it.effect('I5: a hold applies only to the version that was screened', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const db = yield* Db;
      const { actor, evidenceId } = yield* logAs(
        'Maya Chen',
        'Agreed a checkpoint date with the household instead of changing the allocation.',
      );
      // The author revises while the check is in flight; the model then says "hold".
      const revisedMidCheck = provider((request) =>
        db
          .update(schema.evidence)
          .set({ version: sql`${schema.evidence.version} + 1` })
          .where(eq(schema.evidence.id, evidenceId))
          .pipe(Effect.as(everyQuestion(request, 0.99))),
      );
      yield* screenWith(revisedMidCheck, actor, evidenceId);
      const after = yield* evidenceRow(evidenceId);
      assert.strictEqual(after?.status, 'available');
      const holds = yield* db
        .select()
        .from(schema.auditEvent)
        .where(
          and(eq(schema.auditEvent.entityId, evidenceId), eq(schema.auditEvent.event, 'HOLD')),
        );
      assert.strictEqual(holds.length, 0);
    }),
  );
});
