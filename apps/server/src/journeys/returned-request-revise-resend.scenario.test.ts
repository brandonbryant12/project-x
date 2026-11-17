import { Api } from '@repo/api';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: an observer sends a request back; the coachee revises their
 * reflection from the returned observation and resends it with a new note
 * (design 2026-11-17 rev. 3, §9). Protects I7 extended to requests: a
 * reflection held by the privacy screen never goes to an observer, so neither
 * a resend nor a new request is accepted while it is held, and the view offers
 * no "Resend" until it clears.
 */
const client = HttpApiTest.groups(Api, ['observations', 'development']);

const HELD =
  'Mrs. Patterson asked how the fee compared with her account number 4417 2291 at the old firm.';
const CLEAR =
  'They were surprised I raised the fee first. I showed what they would pay elsewhere and asked which services they valued.';

layer(ScenarioLayer, { timeout: 60_000 })('returned request: revise and resend', (it) => {
  it.effect(
    'I7: a returned request is resent only once the revised reflection clears; the observer then signs',
    () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        yield* seedWorld;
        const db = yield* Db;
        const api = yield* client;
        const leoId = yield* signInAs('Leo Okonkwo');
        const jordanId = yield* signInAs('Jordan Blake');

        // The seed: Jordan sent Aisha's request back with a question.
        yield* signInAs('Aisha Bello');
        const returned = (yield* api.observations.inbox()).mine.find(
          (i) => i.status === 'returned',
        );
        assert.isDefined(returned);
        const before = yield* api.observations.get({ params: { id: returned.id } });
        assert.isNotNull(before.returnNote);
        assert.isTrue(before.canReviseEvidence);
        assert.includeMembers([...before.actions], ['RESUBMIT', 'WITHDRAW']);
        const work = before.interaction.id;
        const skillId = before.ratings[0]?.skill.id;
        assert.isDefined(skillId);

        // Revised with a client's details: held, and nothing may go to an observer.
        const held = yield* api.development.reviseEvidence({
          params: { id: work },
          payload: { body: HELD },
        });
        assert.strictEqual(held.evidence?.status, 'held');
        const whileHeld = yield* api.observations.get({ params: { id: returned.id } });
        assert.notInclude(whileHeld.actions, 'RESUBMIT');
        assert.include(whileHeld.actions, 'WITHDRAW');
        assert.isTrue(whileHeld.canReviseEvidence);
        const resend = (note: string | null) =>
          api.observations.transition({
            params: { id: returned.id },
            payload: { event: 'RESUBMIT', note },
          });
        assert.strictEqual((yield* resend(null).pipe(Effect.flip))._tag, 'InvalidTransition');
        // Nor can the same work be put to someone else while it is held.
        const elsewhere = yield* api.observations
          .request({
            payload: {
              interactionId: work,
              observerId: leoId,
              mode: 'saw_it',
              skillIds: [skillId],
              note: null,
            },
          })
          .pipe(Effect.flip);
        assert.strictEqual(elsewhere._tag, 'Unprocessable');
        // The observer sees neither the held words nor a changed state.
        yield* signInAs('Jordan Blake');
        const observerView = yield* api.observations.get({ params: { id: returned.id } });
        assert.strictEqual(observerView.status, 'returned');
        assert.isNull(observerView.evidence?.body ?? null);

        // Revised again without them: clear, so it can be resent with a new note.
        yield* signInAs('Aisha Bello');
        const clear = yield* api.development.reviseEvidence({
          params: { id: work },
          payload: { body: CLEAR },
        });
        assert.strictEqual(clear.evidence?.status, 'available');
        assert.include(
          (yield* api.observations.get({ params: { id: returned.id } })).actions,
          'RESUBMIT',
        );
        const note = 'I added how they reacted and what I asked next.';
        const resent = yield* resend(note);
        assert.strictEqual(resent.status, 'requested');
        assert.strictEqual(resent.requestNote, note);
        assert.isFalse(resent.canReviseEvidence);
        const asked = yield* db
          .select()
          .from(schema.notification)
          .where(
            and(
              eq(schema.notification.entityId, returned.id),
              eq(schema.notification.recipientId, jordanId),
              eq(schema.notification.kind, 'observation_requested'),
            ),
          );
        // Asked once when the request was made and again when it was resent.
        assert.lengthOf(asked, 2);

        // Jordan reads the revised words and the new note, then signs.
        yield* signInAs('Jordan Blake');
        const request = yield* api.observations.get({ params: { id: returned.id } });
        assert.strictEqual(request.evidence?.body, CLEAR);
        assert.strictEqual(request.requestNote, note);
        const skill = request.ratings[0];
        assert.isDefined(skill);
        const signed = yield* api.observations.sign({
          params: { id: request.id },
          payload: {
            version: request.version,
            mode: 'discussed',
            ratings: [{ skillId: skill.skill.id, level: 2, indicatorIds: [], credit: true }],
            narrativeSaw:
              'Aisha raised the fee before they asked and compared it openly with the alternatives.',
            narrativeNext: 'Ask which service they would miss most before naming the fee.',
          },
        });
        assert.strictEqual(signed.status, 'signed');
        assert.lengthOf(signed.credits, 1);
      }),
  );
});
