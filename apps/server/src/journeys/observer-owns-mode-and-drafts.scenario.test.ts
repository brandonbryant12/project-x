import { Api } from '@repo/api';
import type { ObservationId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: a coachee asks for an observation in one mode; the observer
 * records what actually happened.
 * Protects I15 (the observer owns the mode: the requested mode is a
 * suggestion, the signed mode is the observer's and is frozen with the
 * attestation) and I17 (an unsigned draft is the observer's alone: the
 * subject and their leader see neither its levels nor its words).
 */
const client = HttpApiTest.groups(Api, ['observations']);

const SAW =
  'Daniel drew the savings timeline by hand and checked understanding after each step instead of at the end.';
const NEXT = 'Ask the clients to explain the plan back in their own words before closing.';

layer(ScenarioLayer, { timeout: 60_000 })('observer owns mode and drafts', (it) => {
  it.effect(
    'I15/I17: a draft is hidden from subject and leader; the signed mode is the observer’s and frozen',
    () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        yield* seedWorld;
        const api = yield* client;
        const db = yield* Db;
        const danielId = yield* signInAs('Daniel Okafor');
        const samId = yield* signInAs('Sam Rivera');
        const [request] = yield* db
          .select()
          .from(schema.observation)
          .where(
            and(
              eq(schema.observation.subjectId, danielId),
              eq(schema.observation.observerId, samId),
              eq(schema.observation.status, 'requested'),
            ),
          );
        assert.isDefined(request);
        // Daniel asked for a debrief ("discussed"); Sam actually watched the meeting.
        assert.strictEqual(request.mode, 'discussed');
        const id = request.id as ObservationId;
        const view = yield* api.observations.get({ params: { id } });
        const skillId = view.ratings[0]?.skill.id;
        assert.isDefined(skillId);
        const draft = {
          mode: 'saw_it' as const,
          ratings: [
            {
              skillId,
              level: 2 as const,
              indicatorIds: [],
              suggestedIndicatorIds: [],
              credit: true,
            },
          ],
          narrativeSaw: SAW,
          narrativeNext: NEXT,
        };
        const saved = yield* api.observations.saveDraft({
          params: { id },
          payload: { version: view.version, ...draft },
        });
        assert.strictEqual(saved.ratings[0]?.level, 2);

        // I17: neither the subject nor their leader sees the unsigned levels or words.
        for (const viewer of ['Daniel Okafor', 'Leo Okonkwo']) {
          yield* signInAs(viewer);
          const seen = yield* api.observations.get({ params: { id } });
          assert.isNull(seen.ratings[0]?.level ?? null, viewer);
          assert.isFalse(seen.narrativeVisible, viewer);
          assert.strictEqual(seen.narrativeSaw, '', viewer);
          assert.strictEqual(seen.narrativeNext, '', viewer);
        }

        // I15: the observer's mode is what is signed and credited.
        yield* signInAs('Sam Rivera');
        const signed = yield* api.observations.sign({
          params: { id },
          payload: { version: saved.version, ...draft },
        });
        assert.strictEqual(signed.status, 'signed');
        assert.strictEqual(signed.mode, 'saw_it');
        const credits = yield* db
          .select()
          .from(schema.creditEntry)
          .where(eq(schema.creditEntry.observationId, id));
        assert.deepStrictEqual(
          credits.map((c) => [c.mode, c.isFirstHand]),
          [['saw_it', true]],
        );

        // Once signed, the subject sees it — the hiding was the draft's, not the person's.
        yield* signInAs('Daniel Okafor');
        const asSubject = yield* api.observations.get({ params: { id } });
        assert.strictEqual(asSubject.ratings[0]?.level, 2);
        assert.isTrue(asSubject.narrativeVisible);

        // Frozen: the observer cannot redraft it, and the database refuses a rewrite of the mode.
        yield* signInAs('Sam Rivera');
        const redraft = yield* api.observations
          .saveDraft({
            params: { id },
            payload: { version: signed.version, ...draft, mode: 'discussed' },
          })
          .pipe(Effect.flip);
        assert.strictEqual(redraft._tag, 'InvalidTransition');
        const rewritten = yield* db
          .update(schema.observation)
          .set({ mode: 'discussed' })
          .where(eq(schema.observation.id, id))
          .pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          );
        assert.isFalse(rewritten);
      }),
  );

  it.effect('a draft the observer started offers finish or withdraw, never return or decline', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const api = yield* client;
      const db = yield* Db;
      const [maya] = yield* db
        .select()
        .from(schema.person)
        .where(eq(schema.person.displayName, 'Maya Chen'));
      const [skill] = yield* db
        .select()
        .from(schema.skill)
        .where(eq(schema.skill.slug, 'client-discovery'));
      assert.isDefined(maya);
      assert.isDefined(skill);
      yield* signInAs('Sam Rivera');
      const started = yield* api.observations.start({
        payload: {
          subjectId: maya.id,
          activityId: null,
          title: 'Quarterly review with a retired couple',
          occurredOn: '2026-11-16' as never,
          kind: 'client_meeting',
          mode: 'saw_it',
          skillIds: [skill.id],
        },
      });
      const id = started.id;
      const asObserver = yield* api.observations.get({ params: { id } });
      assert.includeMembers([...asObserver.actions], ['SIGN', 'WITHDRAW']);
      assert.notInclude(asObserver.actions, 'RETURN');
      assert.notInclude(asObserver.actions, 'DECLINE');
      yield* signInAs('Maya Chen');
      const asSubject = yield* api.observations.get({ params: { id } });
      assert.notInclude(asSubject.actions, 'WITHDRAW');
    }),
  );
});
