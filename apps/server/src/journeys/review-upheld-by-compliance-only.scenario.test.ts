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
 * Journey: the subject disputes a signed observation and compliance decides.
 * Protects separation of duties (only `compliance_reviewer` upholds or voids;
 * a tenant admin does not), I13 (narratives stay within relationships: a
 * tenant admin sees levels but no narrative) and I6 (a compliance read
 * outside relationships is audited as READ_NARRATIVE).
 */
const client = HttpApiTest.groups(Api, ['observations']);

layer(ScenarioLayer, { timeout: 60_000 })('review upheld by compliance only', (it) => {
  it.effect(
    'the subject requests review; only compliance can uphold, and its read is audited',
    () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        yield* seedWorld;
        const api = yield* client;
        const db = yield* Db;
        const mayaId = yield* signInAs('Maya Chen');
        const samId = yield* signInAs('Sam Rivera');
        const [signed] = yield* db
          .select()
          .from(schema.observation)
          .where(
            and(
              eq(schema.observation.subjectId, mayaId),
              eq(schema.observation.observerId, samId),
              eq(schema.observation.status, 'signed'),
            ),
          );
        assert.isDefined(signed);
        const id = signed.id as ObservationId;

        yield* signInAs('Maya Chen');
        const disputed = yield* api.observations.transition({
          params: { id },
          payload: { event: 'REQUEST_REVIEW', note: 'This was a different client meeting.' },
        });
        assert.strictEqual(disputed.status, 'under_review');

        // Tenant admin: sees the levels, not the words, and cannot decide the review.
        yield* signInAs('Rhea Castillo');
        const asAdmin = yield* api.observations.get({ params: { id } });
        assert.isFalse(asAdmin.narrativeVisible);
        assert.strictEqual(asAdmin.narrativeSaw, '');
        assert.isNotNull(asAdmin.ratings[0]?.level ?? null);
        assert.notInclude(asAdmin.actions, 'UPHOLD');
        assert.notInclude(asAdmin.actions, 'VOID');
        const refused = yield* api.observations
          .transition({ params: { id }, payload: { event: 'UPHOLD', note: null } })
          .pipe(Effect.flip);
        assert.strictEqual(refused._tag, 'Forbidden');

        // Compliance: reads the narrative outside any relationship, and that read is audited.
        const nina = yield* signInAs('Nina Patel');
        const readsBefore = yield* db
          .select()
          .from(schema.auditEvent)
          .where(
            and(eq(schema.auditEvent.entityId, id), eq(schema.auditEvent.event, 'READ_NARRATIVE')),
          );
        const asCompliance = yield* api.observations.get({ params: { id } });
        assert.isTrue(asCompliance.narrativeVisible);
        assert.isAbove(asCompliance.narrativeSaw.length, 0);
        assert.includeMembers([...asCompliance.actions], ['UPHOLD', 'VOID']);
        const reads = yield* db
          .select()
          .from(schema.auditEvent)
          .where(
            and(eq(schema.auditEvent.entityId, id), eq(schema.auditEvent.event, 'READ_NARRATIVE')),
          );
        assert.strictEqual(reads.length, readsBefore.length + 1);
        assert.isTrue(reads.every((r) => r.actorId === nina));

        const upheld = yield* api.observations.transition({
          params: { id },
          payload: { event: 'UPHOLD', note: 'Checked against the meeting record; it stands.' },
        });
        assert.strictEqual(upheld.status, 'signed');
        const credits = yield* db
          .select()
          .from(schema.creditReversal)
          .innerJoin(
            schema.creditEntry,
            eq(schema.creditReversal.creditEntryId, schema.creditEntry.id),
          )
          .where(eq(schema.creditEntry.observationId, id));
        assert.strictEqual(credits.length, 0);
      }),
  );
});
