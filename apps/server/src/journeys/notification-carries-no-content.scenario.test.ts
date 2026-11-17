import { Api } from '@repo/api';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { Effect, Layer, Ref } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { runNotifications } from '../features/notifications/dispatcher.ts';
import { notify } from '../features/shared/notify.ts';
import { NotifierMemory, SentMessages } from '../platform/notifier.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: transitions notify the people they wait on, and nothing a person
 * wrote ever leaves the app (I20, ADR 0018). Also proves the outbox is
 * idempotent: one row per trigger, one send per row.
 */
const client = HttpApiTest.groups(Api, ['observations', 'hub']);
const NARRATIVE =
  'Zebra-marker: she reframed the Hendricks family trust fear around the 2031 date.';
const NEXT_STEP = 'Quokka-marker: agree the checkpoint before ending the call.';

/** Runs the dispatcher until the outbox has nothing left to send. */
const drain = Effect.gen(function* () {
  while ((yield* runNotifications()) > 0) {
    /* keep going */
  }
});

const sentText = Effect.gen(function* () {
  const sent = yield* Ref.get(yield* SentMessages);
  return { sent, text: sent.map((m) => [m.subject, ...m.lines, m.link].join('\n')).join('\n') };
});

layer(ScenarioLayer.pipe(Layer.provideMerge(NotifierMemory)), { timeout: 60_000 })(
  'notifications',
  (it) => {
    it.effect('every waiting person is told, in words from the templates only', () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        yield* seedWorld;
        const db = yield* Db;
        const api = yield* client;

        yield* signInAs('Leo Okonkwo');
        const inbox = yield* api.observations.inbox();
        const request = inbox.requests[0];
        assert.isDefined(request);
        const view = yield* api.observations.get({ params: { id: request.id } });
        const rating = view.ratings[0];
        assert.isDefined(rating);
        yield* api.observations.sign({
          params: { id: view.id },
          payload: {
            version: view.version,
            mode: 'saw_it',
            ratings: [
              {
                skillId: rating.skill.id,
                level: 3,
                indicatorIds: [],
                suggestedIndicatorIds: [],
                credit: true,
              },
            ],
            narrativeSaw: NARRATIVE,
            narrativeNext: NEXT_STEP,
          },
        });

        // Signing enqueued exactly one row for the subject, in the same transaction.
        const signedRows = yield* db
          .select()
          .from(schema.notification)
          .where(eq(schema.notification.entityId, view.id));
        assert.deepStrictEqual(
          signedRows.filter((r) => r.kind === 'observation_signed').map((r) => r.recipientId),
          [view.subject.id],
        );

        yield* drain;
        // Staleness guard: the request Leo just signed is no longer waiting, so its
        // "asked you to observe" row is skipped, never sent after the fact.
        const [stale] = yield* db
          .select()
          .from(schema.notification)
          .where(
            eq(
              schema.notification.dedupeKey,
              `observation_requested:${view.id.toLowerCase()}:${view.observer.id.toLowerCase()}`,
            ),
          );
        assert.strictEqual(stale?.status, 'skipped');
        const { sent, text } = yield* sentText;
        const kinds = new Set(
          (yield* db.select().from(schema.notification))
            .filter((r) => r.status === 'sent')
            .map((r) => r.kind),
        );
        for (const kind of [
          'observation_requested',
          'observation_signed',
          'plan_proposed',
          'weekly_digest',
        ]) {
          assert.isTrue(kinds.has(kind as never), `expected a sent ${kind}`);
        }
        assert.isAbove(sent.length, 3);

        // I20: no narrative, reflection, client reference or level reaches a message.
        assert.notInclude(text, 'Zebra-marker');
        assert.notInclude(text, 'Quokka-marker');
        assert.notInclude(text, 'Hendricks');
        const words = [
          ...(yield* db
            .select({ a: schema.observation.narrativeSaw, b: schema.observation.narrativeNext })
            .from(schema.observation)).flatMap((r) => [r.a, r.b]),
          ...(yield* db.select({ a: schema.evidence.body }).from(schema.evidence)).map((r) => r.a),
          ...(yield* db.select({ a: schema.interaction.clientRef }).from(schema.interaction)).map(
            (r) => r.a,
          ),
        ].filter((w): w is string => typeof w === 'string' && w.length >= 12);
        for (const w of words) assert.notInclude(text, w.slice(0, 24));
        assert.notMatch(text, /level \d|Doing independently|Teaching others/i);
      }),
    );

    it.effect('the outbox is idempotent: one row per trigger, one send per row', () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        const db = yield* Db;
        const before = (yield* sentText).sent.length;
        yield* drain;
        assert.strictEqual((yield* sentText).sent.length, before);

        const [row] = yield* db
          .select()
          .from(schema.notification)
          .where(eq(schema.notification.kind, 'observation_signed'));
        assert.isDefined(row);
        yield* notify(row.tenantId, {
          recipientId: row.recipientId,
          kind: 'observation_signed',
          entityType: 'observation',
          entityId: row.entityId as string,
          actorId: row.actorId,
        });
        const same = yield* db
          .select()
          .from(schema.notification)
          .where(eq(schema.notification.dedupeKey, row.dedupeKey));
        assert.strictEqual(same.length, 1);
      }),
    );

    it.effect('turning notifications off skips them', () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        const api = yield* client;
        const db = yield* Db;
        yield* signInAs('Maya Chen');
        yield* api.hub.updatePreferences({
          payload: { sendEmail: false, weeklyDigest: false },
        });
        const me = (yield* api.hub.preferences()).sendEmail;
        assert.isFalse(me);
        const [maya] = yield* db
          .select()
          .from(schema.person)
          .where(eq(schema.person.displayName, 'Maya Chen'));
        assert.isDefined(maya);
        yield* notify(maya.tenantId, {
          recipientId: maya.id,
          kind: 'engagement_proposed',
          entityType: 'engagement',
          entityId: 'eng_0000000000000000',
          actorId: null,
        });
        const before = (yield* sentText).sent.length;
        yield* drain;
        assert.strictEqual((yield* sentText).sent.length, before);
        const [row] = yield* db
          .select()
          .from(schema.notification)
          .where(
            eq(
              schema.notification.dedupeKey,
              `engagement_proposed:eng_0000000000000000:${maya.id.toLowerCase()}`,
            ),
          );
        assert.strictEqual(row?.status, 'skipped');
      }),
    );
  },
);
