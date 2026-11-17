import { Api } from '@repo/api';
import type { IsoDate } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { SCENARIO_NOW, ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: a leader's 1:1 carries its agenda and commitments forward (ADR 0019).
 * Protects I26 (a conversation is visible only to its two parties; only a
 * leader or engaged coach and their person can schedule one) and I27 (a
 * commitment never writes credit and its text passes the local privacy
 * screen), plus I6 (every transition audited). The scenario clock is
 * 2026-11-16 15:00Z; the seed holds Leo and Maya's last 1:1 twelve days ago.
 */
const client = HttpApiTest.groups(Api, ['rhythm']);
const at = (hoursFromNow: number) =>
  new Date(SCENARIO_NOW + hoursFromNow * 3_600_000).toISOString();

layer(ScenarioLayer, { timeout: 60_000 })('conversation carries commitments', (it) => {
  it.effect('a 1:1 assembles its agenda, and the next one carries the commitment', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const api = yield* client;
      const db = yield* Db;
      const mayaId = yield* signInAs('Maya Chen');
      const leoId = yield* signInAs('Leo Okonkwo');

      const { partners } = yield* api.rhythm.conversations();
      const maya = partners.find((p) => p.person.id === mayaId);
      assert.deepStrictEqual(maya && [maya.basis, maya.asHost], ['leader', true]);

      // "We just met": an hour ago is allowed, so it can be held right away.
      const oneOnOne = yield* api.rhythm.scheduleConversation({
        payload: { withPersonId: mayaId, scheduledFor: at(-1) },
      });
      assert.strictEqual(oneOnOne.host.id, leoId);
      assert.strictEqual(oneOnOne.basis, 'leader');
      assert.strictEqual(oneOnOne.agenda.since, '2026-11-04');
      // Sam's debrief, signed eight days ago, is new since the last 1:1; Maya's
      // follow-up call is waiting on Leo, so it is still unobserved.
      const debrief = oneOnOne.agenda.signedObservations[0];
      assert.isDefined(debrief);
      assert.strictEqual(debrief.observer.displayName, 'Sam Rivera');
      assert.notProperty(debrief, 'narrativeSaw');
      assert.isTrue(
        oneOnOne.agenda.unobservedInteractions.some((i) => i.occurredOn === '2026-11-14'),
      );
      assert.isNotNull(oneOnOne.agenda.nextStep);
      assert.includeMembers([...oneOnOne.actions], ['HOLD', 'MISS', 'CANCEL', 'RESCHEDULE']);

      // Maya commits to the debrief's next step. Text naming a client is refused, not stored.
      yield* signInAs('Maya Chen');
      const held = yield* api.rhythm
        .createCommitment({
          payload: {
            ownerId: mayaId,
            body: 'Call Mrs. Patterson back about her account number',
            dueOn: null,
            conversationId: oneOnOne.id,
            sourceObservationId: debrief.id,
          },
        })
        .pipe(Effect.flip);
      assert.strictEqual(held._tag, 'Unprocessable');
      const commitment = yield* api.rhythm.createCommitment({
        payload: {
          ownerId: mayaId,
          body: 'Ask how confident she feels deciding alone, and write it down.',
          dueOn: '2026-11-30' as IsoDate,
          conversationId: oneOnOne.id,
          sourceObservationId: debrief.id,
        },
      });
      assert.strictEqual(commitment.status, 'open');
      assert.deepStrictEqual([...commitment.actions], ['COMPLETE', 'DROP']);

      yield* signInAs('Leo Okonkwo');
      const heldView = yield* api.rhythm.conversationEvent({
        params: { id: oneOnOne.id },
        payload: { event: 'HOLD', version: oneOnOne.version },
      });
      assert.strictEqual(heldView.status, 'held');
      assert.strictEqual(heldView.heldOn, '2026-11-16');
      assert.deepStrictEqual([...heldView.actions], []);

      const next = yield* api.rhythm.scheduleConversation({
        payload: { withPersonId: mayaId, scheduledFor: at(24 * 7) },
      });
      assert.strictEqual(next.agenda.since, '2026-11-16');
      assert.deepStrictEqual(next.agenda.signedObservations, []);
      assert.isTrue(next.agenda.commitments.some((c) => c.id === commitment.id));
      assert.isAtLeast(next.openCommitments, 1);

      // A commitment never writes credit; every step left an audit row.
      const credit = yield* db
        .select({ id: schema.creditEntry.id })
        .from(schema.creditEntry)
        .where(eq(schema.creditEntry.observationId, debrief.id));
      assert.strictEqual(credit.length, 1); // the debrief's own, from signing
      const audit = yield* db
        .select({ event: schema.auditEvent.event })
        .from(schema.auditEvent)
        .where(
          and(
            inArray(schema.auditEvent.entityId, [oneOnOne.id, commitment.id]),
            inArray(schema.auditEvent.entityType, ['conversation', 'commitment']),
          ),
        );
      assert.sameMembers(
        audit.map((a) => a.event),
        ['SCHEDULE', 'CREATE', 'HOLD'],
      );
    }),
  );

  it.effect('a stranger can neither schedule nor read; a 1:1 is not held before it starts', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const api = yield* client;
      const mayaId = yield* signInAs('Maya Chen');
      yield* signInAs('Leo Okonkwo');
      const tomorrow = yield* api.rhythm.scheduleConversation({
        payload: { withPersonId: mayaId, scheduledFor: at(20) },
      });
      assert.notInclude(tomorrow.actions, 'HOLD');
      const early = yield* api.rhythm
        .conversationEvent({
          params: { id: tomorrow.id },
          payload: { event: 'HOLD', version: tomorrow.version },
        })
        .pipe(Effect.flip);
      assert.strictEqual(early._tag, 'InvalidTransition');

      // Priya leads another branch: no relationship with Maya.
      yield* signInAs('Priya Raman');
      const refused = yield* api.rhythm
        .scheduleConversation({ payload: { withPersonId: mayaId, scheduledFor: at(48) } })
        .pipe(Effect.flip);
      assert.strictEqual(refused._tag, 'Forbidden');
      const hidden = yield* api.rhythm
        .conversation({ params: { id: tomorrow.id } })
        .pipe(Effect.flip);
      assert.strictEqual(hidden._tag, 'NotFound');
      const commitments = yield* api.rhythm
        .commitments({ params: { id: mayaId } })
        .pipe(Effect.flip);
      assert.strictEqual(commitments._tag, 'NotFound');
      const { upcoming } = yield* api.rhythm.conversations();
      assert.isFalse(upcoming.some((c) => c.id === tomorrow.id));
    }),
  );
});
