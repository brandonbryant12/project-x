import { Api } from '@repo/api';
import type { IsoDate, PersonId } from '@repo/domain';
import { assert, layer } from '@effect/vitest';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: work is recorded close to when it happened.
 * Protects I16 (backdating bounds): an advisor logs work at most 30 days back,
 * and an observer's "I saw this" at most 14 days back. Older dates are refused
 * on the `occurredOn` field; the last allowed day is accepted. The scenario
 * clock is 2026-11-16.
 */
const client = HttpApiTest.groups(Api, ['observations', 'development']);

const LOG_LAST_ALLOWED = '2026-10-17' as IsoDate; // today − 30
const LOG_TOO_OLD = '2026-10-16' as IsoDate;
const OBSERVE_LAST_ALLOWED = '2026-11-02' as IsoDate; // today − 14
const OBSERVE_TOO_OLD = '2026-11-01' as IsoDate;

layer(ScenarioLayer, { timeout: 60_000 })('backdating bounds', (it) => {
  it.effect('I16: logging work older than 30 days is refused on occurredOn', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const api = yield* client;
      yield* signInAs('Maya Chen');
      const log = (occurredOn: IsoDate) =>
        api.development.logInteraction({
          payload: {
            activityId: null,
            adHocTitle: 'Annual review with a long-standing household',
            adHocSkillIds: [],
            occurredOn,
            kind: 'client_meeting',
            clientRef: null,
            reflection: 'Led the goals conversation before showing any performance numbers.',
          },
        });
      const refused = yield* log(LOG_TOO_OLD).pipe(Effect.flip);
      assert.strictEqual(refused._tag, 'Unprocessable');
      assert.strictEqual(refused._tag === 'Unprocessable' && refused.field, 'occurredOn');
      const accepted = yield* log(LOG_LAST_ALLOWED);
      assert.strictEqual(accepted.occurredOn, LOG_LAST_ALLOWED);
    }),
  );

  it.effect('I16: "I saw this" older than 14 days is refused on occurredOn', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const api = yield* client;
      const mayaId: PersonId = yield* signInAs('Maya Chen');
      const skillId = (yield* api.development.mine()).plan?.focusSkills[0]?.skill.id;
      assert.isDefined(skillId);
      // Sam coaches Maya, so only the date can make this refusal happen.
      yield* signInAs('Sam Rivera');
      const start = (occurredOn: IsoDate) =>
        api.observations.start({
          payload: {
            subjectId: mayaId,
            activityId: null,
            title: 'Shadowed a discovery meeting',
            occurredOn,
            kind: 'client_meeting',
            mode: 'saw_it',
            skillIds: [skillId],
          },
        });
      const refused = yield* start(OBSERVE_TOO_OLD).pipe(Effect.flip);
      assert.strictEqual(refused._tag, 'Unprocessable');
      assert.strictEqual(refused._tag === 'Unprocessable' && refused.field, 'occurredOn');
      const accepted = yield* start(OBSERVE_LAST_ALLOWED);
      assert.strictEqual(accepted.interaction.occurredOn, OBSERVE_LAST_ALLOWED);
    }),
  );
});
