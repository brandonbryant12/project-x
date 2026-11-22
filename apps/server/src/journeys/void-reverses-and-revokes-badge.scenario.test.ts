import { Api } from '@repo/api';
import type { ObservationId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: compliance voids a signed observation that completed a badge.
 * Protects I2 (only voiding writes reversals; credit agrees with its
 * observation) and I3 (the ledger is append-only): the void appends one
 * reversal per credit, revokes the badge that observation completed, and
 * leaves every credit_entry row exactly as it was.
 */
const client = HttpApiTest.groups(Api, ['observations']);

layer(ScenarioLayer, { timeout: 60_000 })('void reverses credit and revokes the badge', (it) => {
  it.effect('I2/I3: a void appends reversals and revokes the badge; the ledger is untouched', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const api = yield* client;
      const db = yield* Db;
      const mayaId = yield* signInAs('Maya Chen');
      const [badge] = yield* db
        .select()
        .from(schema.badgeAward)
        .where(and(eq(schema.badgeAward.personId, mayaId), eq(schema.badgeAward.status, 'awarded')))
        .orderBy(asc(schema.badgeAward.level));
      assert.isDefined(badge);
      const triggering = badge.triggeringObservationId as ObservationId;
      const ledgerBefore = yield* db
        .select()
        .from(schema.creditEntry)
        .where(eq(schema.creditEntry.personId, mayaId))
        .orderBy(asc(schema.creditEntry.id));
      const skillCredits = ledgerBefore.filter((c) => c.skillId === badge.skillId);
      const voidedCredits = ledgerBefore.filter((c) => c.observationId === triggering);
      assert.isAbove(voidedCredits.length, 0);

      // A tenant admin without the compliance grant cannot void.
      yield* signInAs('Rhea Castillo');
      const asAdmin = yield* api.observations.get({ params: { id: triggering } });
      assert.notInclude(asAdmin.actions, 'VOID');
      const refused = yield* api.observations
        .transition({ params: { id: triggering }, payload: { event: 'VOID', note: 'duplicate' } })
        .pipe(Effect.flip);
      assert.strictEqual(refused._tag, 'Forbidden');

      yield* signInAs('Nina Patel');
      const voided = yield* api.observations.transition({
        params: { id: triggering },
        payload: { event: 'VOID', note: 'Recorded against the wrong meeting.' },
      });
      assert.strictEqual(voided.status, 'voided');

      // Under simplified POC criteria (2 observations), Maya's 3rd seeded observation still
      // covers the badge until a second observation is voided to drop below the threshold.
      const extraObs = skillCredits.find((c) => c.observationId !== triggering)?.observationId as
        | ObservationId
        | undefined;
      if (extraObs) {
        yield* api.observations.transition({
          params: { id: extraObs },
          payload: { event: 'VOID', note: 'Also logged against the wrong meeting.' },
        });
      }

      const reversals = yield* db
        .select()
        .from(schema.creditReversal)
        .where(
          inArray(
            schema.creditReversal.creditEntryId,
            skillCredits.map((c) => c.id),
          ),
        );
      assert.isAtLeast(reversals.length, voidedCredits.length);

      const [after] = yield* db
        .select()
        .from(schema.badgeAward)
        .where(eq(schema.badgeAward.id, badge.id));
      assert.strictEqual(after?.status, 'revoked');
      assert.include(
        reversals.map((r) => r.id),
        after?.revokedByReversalId,
      );
      const revokeAudit = yield* db
        .select()
        .from(schema.auditEvent)
        .where(
          and(eq(schema.auditEvent.entityId, badge.id), eq(schema.auditEvent.event, 'REVOKE')),
        );
      assert.strictEqual(revokeAudit.length, 1);

      const ledgerAfter = yield* db
        .select()
        .from(schema.creditEntry)
        .where(eq(schema.creditEntry.personId, mayaId))
        .orderBy(asc(schema.creditEntry.id));
      assert.deepStrictEqual(ledgerAfter, ledgerBefore);

      // Voided is final: a second void is refused rather than reversing twice.
      const again = yield* api.observations
        .transition({ params: { id: triggering }, payload: { event: 'VOID', note: 'again' } })
        .pipe(Effect.flip);
      assert.strictEqual(again._tag, 'InvalidTransition');
    }),
  );
});
