import { Api } from '@repo/api';
import type { IsoDate } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: a leader names a colleague to observe one of their people; the
 * designee finds them in "I saw this", captures without naming the work, and
 * signs. Credit carries the `designated` basis. Once the designation ends, the
 * designee can no longer observe them.
 * Protects I21 (designations) and I4 (the basis points at the exact edge), and
 * pins the quick-capture default path (no title, no activity) that regressed.
 */
const client = HttpApiTest.groups(Api, ['observations', 'hub']);
const day = (s: string) => s as IsoDate;

layer(ScenarioLayer, { timeout: 60_000 })('designated observer signs', (it) => {
  it.effect('I21/I4: a designee observes through the UI path, and stops when it ends', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const api = yield* client;
      const db = yield* Db;
      const mayaId = yield* signInAs('Maya Chen');
      const marcusId = yield* signInAs('Marcus Hill');
      const before = (yield* api.observations.targets()).people;
      assert.isFalse(before.some((t) => t.person.id === mayaId));

      yield* signInAs('Leo Okonkwo');
      const designation = yield* api.hub.designate({
        payload: {
          subjectId: mayaId,
          observerId: marcusId,
          validFrom: day('2026-11-16'),
          validTo: day('2026-12-16'),
        },
      });

      yield* signInAs('Marcus Hill');
      const targets = (yield* api.observations.targets()).people;
      const maya = targets.find((t) => t.person.id === mayaId);
      assert.isDefined(maya);
      assert.strictEqual(maya.basis, 'designated');
      const skill = maya.focusSkills[0];
      assert.isDefined(skill);

      // The quick-capture default: no activity, no title.
      const started = yield* api.observations.start({
        payload: {
          subjectId: mayaId,
          activityId: null,
          title: null,
          occurredOn: day('2026-11-16'),
          kind: 'client_meeting',
          mode: 'saw_it',
          skillIds: [skill.id],
        },
      });
      const signed = yield* api.observations.sign({
        params: { id: started.id },
        payload: {
          version: started.version,
          mode: 'saw_it',
          ratings: [
            {
              skillId: skill.id,
              level: 2,
              indicatorIds: [],
              credit: true,
            },
          ],
          narrativeSaw:
            'She asked what a good year looked like for them before opening the portfolio.',
          narrativeNext: 'Summarise their answer back before proposing anything.',
        },
      });
      assert.strictEqual(signed.status, 'signed');
      const [row] = yield* db
        .select()
        .from(schema.observation)
        .where(eq(schema.observation.id, started.id));
      assert.strictEqual(row?.basis, 'designated');
      assert.strictEqual(row?.basisDesignationId, designation.id);
      const credits = yield* db
        .select()
        .from(schema.creditEntry)
        .where(eq(schema.creditEntry.observationId, started.id));
      assert.deepStrictEqual(
        credits.map((c) => [c.observerId, c.level]),
        [[marcusId, 2]],
      );

      yield* signInAs('Leo Okonkwo');
      yield* api.hub.endDesignation({ params: { id: designation.id } });
      yield* signInAs('Marcus Hill');
      const after = (yield* api.observations.targets()).people;
      assert.isFalse(after.some((t) => t.person.id === mayaId));
      const refused = yield* api.observations
        .start({
          payload: {
            subjectId: mayaId,
            activityId: null,
            title: null,
            occurredOn: day('2026-11-16'),
            kind: 'client_meeting',
            mode: 'saw_it',
            skillIds: [skill.id],
          },
        })
        .pipe(Effect.flip);
      assert.include(['Forbidden', 'Unprocessable'], refused._tag);
    }),
  );
});
