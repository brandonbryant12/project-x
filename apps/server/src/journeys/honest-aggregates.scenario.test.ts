import { Api } from '@repo/api';
import type { IsoDate, ObservationId, TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { desc, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { adoptionRows } from '../features/hub/adoption.ts';
import { coveragePeople } from '../features/shared/program.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, SCENARIO_NOW, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: compliance voids observations, and every aggregate stops counting
 * them. Team coverage reads only credit that stands (a reversed credit is not
 * an observation), falling back to the previous real one; the adoption
 * figures leave voided observations out; and "with a plan" is suppressed
 * under the minimum like every other figure (ADR 0021).
 */
const client = HttpApiTest.groups(Api, ['support', 'observations', 'hub']);

layer(ScenarioLayer, { timeout: 60_000 })('honest aggregates', (it) => {
  it.effect('a voided observation no longer counts in team coverage or adoption', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const db = yield* Db;
      const api = yield* client;

      // The seeded firm has four people with a plan: every adoption figure is withheld.
      yield* signInAs('Rhea Castillo');
      const adoption = yield* api.hub.adoption();
      assert.deepStrictEqual(
        [adoption.withPlan, adoption.observedRecently, adoption.medianDaysToSign],
        [null, null, null],
      );

      const mayaId = yield* signInAs('Maya Chen');
      const [maya] = yield* db.select().from(schema.person).where(eq(schema.person.id, mayaId));
      assert.isDefined(maya);
      const tenantId = maya.tenantId as TenantId;
      const credits = yield* db
        .select()
        .from(schema.creditEntry)
        .where(eq(schema.creditEntry.personId, mayaId))
        .orderBy(desc(schema.creditEntry.demonstratedOn));
      const bySkill = new Map<string, Array<(typeof credits)[number]>>();
      for (const c of credits) bySkill.set(c.skillId, [...(bySkill.get(c.skillId) ?? []), c]);
      // One skill observed once, one observed several times (latest first).
      const once = [...bySkill.values()].find((cs) => cs.length === 1)?.[0];
      const several = [...bySkill.values()].find((cs) => cs.length >= 3);
      assert.isDefined(once);
      assert.isDefined(several);
      const [latest, previous, earliest] = several;
      assert.isDefined(latest);
      assert.isDefined(previous);
      assert.isDefined(earliest);

      const mayaRow = Effect.gen(function* () {
        yield* signInAs('Leo Okonkwo');
        const team = yield* api.support.team();
        const row = team.rows.find((r) => r.person.id === mayaId);
        assert.isDefined(row);
        const dot = (skillId: string) => row.coverage.find((c) => c.skill.id === skillId);
        return { row, once: dot(once.skillId), several: dot(several[0]!.skillId) };
      });
      const before = yield* mayaRow;
      assert.deepStrictEqual(
        [before.once?.observedRecently, before.once?.lastObservedOn],
        [true, once.demonstratedOn],
      );
      assert.strictEqual(before.row.lastObservedOn, latest.demonstratedOn);
      const now = new Date(SCENARIO_NOW);
      const from = new Date('2026-10-01T00:00:00Z');
      assert.include((yield* coveragePeople(tenantId, '2026-11-16' as IsoDate)).observed, mayaId);
      assert.include(
        (yield* adoptionRows(tenantId, from, now)).signed.map((r) => r.subjectId),
        mayaId,
      );

      const voidIt = (id: string) =>
        Effect.gen(function* () {
          yield* signInAs('Nina Patel');
          yield* api.observations.transition({
            params: { id: id as ObservationId },
            payload: { event: 'VOID', note: 'Recorded against the wrong meeting.' },
          });
        });
      yield* voidIt(once.observationId);
      yield* voidIt(latest.observationId);

      const after = yield* mayaRow;
      // The only observation of that skill is void: not recently observed, never observed.
      assert.deepStrictEqual(
        [after.once?.observedRecently, after.once?.lastObservedOn, after.once?.lastObserver],
        [false, null, null],
      );
      // The other skill falls back to its previous real observation, and so does the person.
      assert.strictEqual(after.several?.lastObservedOn, previous.demonstratedOn);
      assert.strictEqual(after.row.lastObservedOn, previous.demonstratedOn);

      // With every recent observation of Maya void, adoption no longer counts her.
      yield* voidIt(previous.observationId);
      assert.notInclude(
        (yield* coveragePeople(tenantId, '2026-11-16' as IsoDate)).observed,
        mayaId,
      );
      const rows = yield* adoptionRows(tenantId, from, now);
      assert.notInclude(
        rows.signed.map((r) => r.subjectId),
        mayaId,
      );
      assert.strictEqual((yield* mayaRow).row.lastObservedOn, earliest.demonstratedOn);
    }),
  );
});
