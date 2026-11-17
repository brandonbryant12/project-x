import { Api } from '@repo/api';
import type { IsoDate } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq, gte, lt } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: "I saw this" never widens who reads a person's development (I47).
 * A person's logged work is offered only to their development viewers (their
 * coaches and leader chain), and only work the viewer was eligible to observe
 * on its date. A designee without development access sees no logged work,
 * cannot attach to it, and never receives a reflection the subject did not
 * share by asking them; they still record new work they saw. A coach still
 * attaches and reads it, and stops reading it once they no longer coach.
 */
const client = HttpApiTest.groups(Api, ['observations', 'hub', 'development', 'support']);
const day = (s: string) => s as IsoDate;
const SECRET = 'Private worry: I felt out of my depth and nearly cancelled the meeting.';

layer(ScenarioLayer, { timeout: 120_000 })('logged work and reflections stay private', (it) => {
  it.effect(
    'I47: a designee sees no logged work, cannot attach, and never receives the reflection; a coach can',
    () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        yield* seedWorld;
        const api = yield* client;
        const db = yield* Db;
        const maya = yield* signInAs('Maya Chen');
        const marcus = yield* signInAs('Marcus Hill');
        const rhea = yield* signInAs('Rhea Castillo');

        // Leo names Marcus (no development access) and Rhea (his own leader) for Maya from today.
        yield* signInAs('Leo Okonkwo');
        for (const observerId of [marcus, rhea]) {
          yield* api.hub.designate({
            payload: {
              subjectId: maya,
              observerId,
              validFrom: day('2026-11-16'),
              validTo: day('2026-12-16'),
            },
          });
        }

        yield* signInAs('Maya Chen');
        const work = yield* api.development.logInteraction({
          payload: {
            activityId: null,
            adHocTitle: 'Talk with the Smith household',
            adHocSkillIds: [],
            occurredOn: day('2026-11-16'),
            kind: 'client_meeting',
            clientRef: null,
            reflection: SECRET,
          },
        });
        assert.strictEqual(work.evidence?.status, 'available');

        // Marcus can observe Maya, but her logged work is not his to see.
        yield* signInAs('Marcus Hill');
        const asMarcus = (yield* api.observations.targets()).people.find(
          (t) => t.person.id === maya,
        );
        assert.isDefined(asMarcus);
        assert.deepStrictEqual(asMarcus.work, []);
        const skill = asMarcus.focusSkills[0];
        assert.isDefined(skill);
        const start = (interactionId: typeof work.id | undefined) =>
          api.observations.start({
            payload: {
              subjectId: maya,
              interactionId: interactionId ?? null,
              activityId: null,
              title: null,
              occurredOn: day('2026-11-16'),
              kind: 'client_meeting',
              mode: 'saw_it',
              skillIds: [skill.id],
            },
          });
        assert.strictEqual((yield* start(work.id).pipe(Effect.flip))._tag, 'NotFound');
        // He records what he saw as new work, which carries no reflection.
        const own = yield* start(undefined);
        assert.isNull(own.evidence);

        // Rhea may see Maya's development, but was eligible only from today:
        // earlier work is not offered, and attaching to it is refused.
        yield* signInAs('Rhea Castillo');
        const asRhea = (yield* api.observations.targets()).people.find((t) => t.person.id === maya);
        assert.isDefined(asRhea);
        assert.include(
          asRhea.work.map((w) => w.id),
          work.id,
        );
        assert.isTrue(asRhea.work.every((w) => w.occurredOn >= day('2026-11-16')));
        const [earlier] = yield* db
          .select({ id: schema.interaction.id })
          .from(schema.interaction)
          .where(
            and(
              eq(schema.interaction.ownerId, maya),
              gte(schema.interaction.occurredOn, day('2026-11-03')),
              lt(schema.interaction.occurredOn, day('2026-11-16')),
            ),
          )
          .limit(1);
        assert.isDefined(earlier);
        const attachEarlier = yield* api.observations
          .start({
            payload: {
              subjectId: maya,
              interactionId: earlier.id,
              activityId: null,
              title: null,
              occurredOn: day('2026-11-16'),
              kind: 'client_meeting',
              mode: 'saw_it',
              skillIds: [skill.id],
            },
          })
          .pipe(Effect.flip);
        assert.strictEqual(attachEarlier._tag, 'Forbidden');

        // Sam, her coach, is offered the work, attaches, and reads her reflection.
        yield* signInAs('Sam Rivera');
        const asSam = (yield* api.observations.targets()).people.find((t) => t.person.id === maya);
        assert.include(
          asSam?.work.map((w) => w.id),
          work.id,
        );
        const attached = yield* api.observations.start({
          payload: {
            subjectId: maya,
            interactionId: work.id,
            activityId: null,
            title: null,
            occurredOn: day('2026-11-16'),
            kind: 'client_meeting',
            mode: 'saw_it',
            skillIds: [skill.id],
          },
        });
        assert.strictEqual(attached.evidence?.body, SECRET);
        assert.strictEqual(
          (yield* api.observations.inbox()).drafts.find((d) => d.id === attached.id)
            ?.evidencePreview,
          SECRET,
        );

        // Once Sam no longer coaches her, his own observation keeps its record but not her words.
        const [engagement] = yield* db
          .select({ id: schema.engagement.id })
          .from(schema.engagement)
          .where(
            and(eq(schema.engagement.coacheeId, maya), eq(schema.engagement.status, 'active')),
          );
        assert.isDefined(engagement);
        yield* signInAs('Maya Chen');
        yield* api.support.engagementEvent({
          params: { id: engagement.id },
          payload: { event: 'END' },
        });
        yield* signInAs('Sam Rivera');
        const after = yield* api.observations.get({ params: { id: attached.id } });
        assert.isNull(after.evidence);
        assert.isNull(
          (yield* api.observations.inbox()).drafts.find((d) => d.id === attached.id)
            ?.evidencePreview,
        );

        // When Maya asks Marcus herself, she shares the reflection with him.
        yield* signInAs('Maya Chen');
        const asked = yield* api.observations.request({
          payload: {
            interactionId: work.id,
            observerId: marcus,
            mode: 'saw_it',
            skillIds: [skill.id],
            note: null,
          },
        });
        yield* signInAs('Marcus Hill');
        const requested = yield* api.observations.get({ params: { id: asked.id } });
        assert.strictEqual(requested.evidence?.body, SECRET);
      }),
  );
});
