import { Api } from '@repo/api';
import type { ObservationId, PersonId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: Home leads with what to practise.
 * Protects the Home "Try next time" invariant: it is the viewer's latest
 * signed "What next" (signed or under review), never a draft's words and never
 * a voided observation's, with who wrote it, when, and a link to it.
 */
const client = HttpApiTest.groups(Api, ['support', 'observations']);

const DRAFT_NEXT = 'Words from an unsigned draft that must never reach Home.';

/** Maya's observations that carry a "What next", with their state and signing time. */
const withNextAbout = (subjectId: PersonId) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db
      .select({
        id: schema.observation.id,
        status: schema.observation.status,
        signedAt: schema.observation.signedAt,
        narrativeNext: schema.observation.narrativeNext,
      })
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.subjectId, subjectId),
          isNotNull(schema.observation.narrativeNext),
          ne(schema.observation.narrativeNext, ''),
        ),
      );
  });

const latestSignedTime = (rows: Effect.Success<ReturnType<typeof withNextAbout>>) =>
  Math.max(
    ...rows
      .filter((r) => r.status === 'signed' || r.status === 'under_review')
      .map((r) => r.signedAt?.getTime() ?? 0),
  );

layer(ScenarioLayer, { timeout: 60_000 })('Home leads with try next time', (it) => {
  it.effect('shows the latest signed "What next"; ignores drafts and voided observations', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const api = yield* client;
      const mayaId = yield* signInAs('Maya Chen');

      // The latest signed "What next" about Maya leads Home, with its author and link.
      const before = yield* withNextAbout(mayaId);
      assert.isAtLeast(
        before.filter((r) => r.status === 'signed').length,
        2,
        'the seed has several signed observations of Maya with a "What next"',
      );
      const home = yield* api.support.home();
      const shown = home.tryNextTime;
      assert.isNotNull(shown);
      const shownRow = before.find((r) => r.id === shown?.observationId);
      assert.isDefined(shownRow);
      assert.strictEqual(shownRow.status, 'signed');
      assert.strictEqual(shown?.sentence, shownRow.narrativeNext);
      assert.strictEqual(Date.parse(shown?.signedAt ?? ''), latestSignedTime(before));
      // The progress line stays, under it.
      assert.isNotNull(home.nextStep);

      // Leo saves a newer draft for Maya with its own "What next": Home does not change.
      yield* signInAs('Leo Okonkwo');
      const inbox = yield* api.observations.inbox();
      const request = inbox.requests.find((r) => r.subject.id === mayaId);
      assert.isDefined(request, 'the seed has a request from Maya to Leo');
      const view = yield* api.observations.get({ params: { id: request.id } });
      const skillId = view.ratings[0]?.skill.id;
      assert.isDefined(skillId);
      yield* api.observations.saveDraft({
        params: { id: view.id },
        payload: {
          version: view.version,
          mode: 'saw_it',
          ratings: [{ skillId, level: 2, indicatorIds: [], credit: true }],
          narrativeSaw: 'She asked what the money was for before showing any numbers.',
          narrativeNext: DRAFT_NEXT,
        },
      });
      yield* signInAs('Maya Chen');
      const withDraft = yield* api.support.home();
      assert.strictEqual(withDraft.tryNextTime?.observationId, shown?.observationId);
      assert.notStrictEqual(withDraft.tryNextTime?.sentence, DRAFT_NEXT);

      // Compliance voids the observation Home was quoting: Home falls back to the
      // latest one that still stands, never the voided one.
      yield* signInAs('Nina Patel');
      yield* api.observations.transition({
        params: { id: shown?.observationId as ObservationId },
        payload: { event: 'VOID', note: 'Recorded against the wrong meeting.' },
      });
      yield* signInAs('Maya Chen');
      const after = yield* withNextAbout(mayaId);
      const fallback = (yield* api.support.home()).tryNextTime;
      assert.isNotNull(fallback);
      assert.notStrictEqual(fallback?.observationId, shown?.observationId);
      const fallbackRow = after.find((r) => r.id === fallback?.observationId);
      assert.include(['signed', 'under_review'], fallbackRow?.status);
      assert.strictEqual(Date.parse(fallback?.signedAt ?? ''), latestSignedTime(after));
      const db = yield* Db;
      const voided = yield* db
        .select({ id: schema.observation.id })
        .from(schema.observation)
        .where(
          and(eq(schema.observation.subjectId, mayaId), eq(schema.observation.status, 'voided')),
        );
      assert.deepStrictEqual(
        voided.map((v) => v.id),
        [shown?.observationId],
      );
    }),
  );
});
