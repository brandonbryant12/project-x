import { Api } from '@repo/api';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: an advisor's work is observed, signed and credited.
 * Protects I1 (no self-credit), I2 (credit only from SIGN), I4 (eligibility),
 * I6 (audited transitions), I7 (held text hidden from others), I13 (the plan's
 * "Try next time" quotes a narrative only to its readers) and the
 * "actions drive the UI" contract — end to end through HTTP, use cases and SQL.
 */
const client = HttpApiTest.groups(Api, ['observations', 'development', 'support', 'admin']);

layer(ScenarioLayer, { timeout: 60_000 })('observe → sign → credit', (it) => {
  it.effect('seeds a world where the rules have already produced badges', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const db = yield* Db;
      const badges = yield* db.select().from(schema.badgeAward);
      // Maya (discovery L2+L3) and Tom (behavioral coaching L2+L3) earned theirs through signing.
      assert.strictEqual(badges.length, 4);
    }),
  );

  it.effect(
    'a leader signs a requested observation; credit and audit follow; the subject acknowledges',
    () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        const api = yield* client;
        yield* signInAs('Leo Okonkwo');
        const inbox = yield* api.observations.inbox();
        const request = inbox.requests[0];
        assert.isDefined(request);
        const view = yield* api.observations.get({ params: { id: request.id } });
        assert.include(view.actions, 'SIGN');
        const rating = view.ratings[0];
        assert.isDefined(rating);

        const incomplete = yield* api.observations
          .sign({
            params: { id: view.id },
            payload: {
              version: view.version,
              mode: 'reviewed_work',
              ratings: [
                {
                  skillId: rating.skill.id,
                  level: 3,
                  indicatorIds: [],
                  credit: true,
                },
              ],
              narrativeSaw: 'Good.',
              narrativeNext: '',
            },
          })
          .pipe(Effect.flip);
        assert.strictEqual(incomplete._tag, 'InvalidTransition');

        const signed = yield* api.observations.sign({
          params: { id: view.id },
          payload: {
            version: view.version,
            mode: 'reviewed_work',
            ratings: [
              {
                skillId: rating.skill.id,
                level: 3,
                indicatorIds: [],
                credit: true,
              },
            ],
            narrativeSaw:
              'She reframed the client’s fear against his retirement date and let him choose a checkpoint himself.',
            narrativeNext: 'Agree the checkpoint date before ending the call.',
          },
        });
        assert.strictEqual(signed.status, 'signed');
        assert.deepStrictEqual(
          signed.credits.map((c) => [c.level, c.firstHand]),
          [[3, true]],
        );

        const db = yield* Db;
        const audit = yield* db
          .select()
          .from(schema.auditEvent)
          .where(and(eq(schema.auditEvent.entityId, view.id), eq(schema.auditEvent.event, 'SIGN')));
        assert.strictEqual(audit.length, 1);
        assert.strictEqual(audit[0]?.toState, 'signed');

        const mayaId = yield* signInAs('Maya Chen');
        const forbidden = yield* api.observations
          .transition({
            params: { id: view.id },
            payload: { event: 'VOID', note: 'not mine to void' },
          })
          .pipe(Effect.flip);
        assert.strictEqual(forbidden._tag, 'Forbidden');
        const acknowledged = yield* api.observations.transition({
          params: { id: view.id },
          payload: { event: 'ACKNOWLEDGE', note: null },
        });
        assert.isNotNull(acknowledged.acknowledgedAt);
        assert.notInclude(acknowledged.actions, 'REQUEST_REVIEW');

        // I13: the plan shows the latest "What next" to Maya, never to the wider chain.
        const mine = yield* api.development.mine();
        assert.strictEqual(
          mine.plan?.tryNextTime?.sentence,
          'Agree the checkpoint date before ending the call.',
        );
        yield* signInAs('Rhea Castillo');
        const asChain = yield* api.development.of({ params: { id: mayaId } });
        assert.isNotNull(asChain.plan);
        assert.isNull(asChain.plan?.tryNextTime);
      }),
  );

  it.effect('nobody can ask an ineligible person, or themselves, to credit them', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const api = yield* client;
      const graceId = yield* signInAs('Grace Liu');
      const mayaId = yield* signInAs('Maya Chen');
      const development = yield* api.development.mine();
      const interaction = development.plan?.activities.flatMap((a) => a.interactions)[0];
      assert.isDefined(interaction);
      const skillId = development.plan?.focusSkills[0]?.skill.id;
      assert.isDefined(skillId);
      for (const observerId of [graceId, mayaId]) {
        const refused = yield* api.observations
          .request({
            payload: {
              interactionId: interaction.id,
              observerId,
              mode: 'saw_it',
              skillIds: [skillId],
              note: null,
            },
          })
          .pipe(Effect.flip);
        assert.strictEqual(refused._tag, 'Forbidden');
      }
    }),
  );

  it.effect('a reflection held for privacy is visible to its author only, with the reason', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const api = yield* client;
      const db = yield* Db;
      const [held] = yield* db
        .select()
        .from(schema.evidence)
        .where(eq(schema.evidence.status, 'held'));
      assert.isDefined(held);
      yield* signInAs('Aisha Bello');
      const asAuthor = yield* api.development.interaction({ params: { id: held.interactionId } });
      assert.isNotNull(asAuthor.evidence?.body);
      assert.match(asAuthor.evidence?.holdReason ?? '', /privacy/i);
      yield* signInAs('Jordan Blake');
      const asCoach = yield* api.development.interaction({ params: { id: held.interactionId } });
      assert.isNull(asCoach.evidence?.body);
    }),
  );

  it.effect('the database refuses to rewrite a signed attestation even if code tried', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const db = yield* Db;
      const [signed] = yield* db
        .select()
        .from(schema.observation)
        .where(eq(schema.observation.status, 'signed'));
      assert.isDefined(signed);
      const refused = yield* db
        .update(schema.observation)
        .set({ narrativeSaw: 'rewritten after the fact' })
        .where(eq(schema.observation.id, signed.id))
        .pipe(
          Effect.map(() => false),
          Effect.catch(() => Effect.succeed(true)),
        );
      assert.isTrue(refused);
    }),
  );
});
