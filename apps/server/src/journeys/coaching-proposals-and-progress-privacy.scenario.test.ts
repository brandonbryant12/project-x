import { Api, CurrentActor } from '@repo/api';
import { EngagementId, PersonId, RoleGrantId, type GrantRole, type IsoDate } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect, Option } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { loadActor } from '../auth/sessions.ts';
import { isUniqueViolation } from '../features/shared/mutation.ts';
import { proposeEngagement } from '../features/support/use-cases.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: proposing coaching from a profile, and who sees a person's progress there.
 * Protects the coaching-proposal invariant end to end (the profile offers
 * exactly the directions `proposableDirections` allows, and the propose use
 * case refuses the rest with the right error) and progress privacy (a person's
 * progress reaches only them, their active coaches and their leader chain;
 * an unrelated colleague, a program owner and a tenant admin get none from the
 * profile or coaching endpoints). Two proposals crossing in opposite
 * directions give one proposal and one Conflict, never a server error (I45).
 */
const client = HttpApiTest.groups(Api, ['people', 'support']);

/** Added for this test: grants without any relationship to Maya. */
const ADDED: ReadonlyArray<{ name: string; grant: GrantRole }> = [
  { name: 'Pia Lund', grant: 'program_owner' },
  { name: 'Ada Ruiz', grant: 'tenant_admin' },
];

layer(ScenarioLayer, { timeout: 60_000 })('coaching proposals and progress privacy', (it) => {
  it.effect('outsiders get no per-person progress from the profile or coaching views', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const api = yield* client;
      const db = yield* Db;
      const mayaId = yield* signInAs('Maya Chen');
      const [maya] = yield* db.select().from(schema.person).where(eq(schema.person.id, mayaId));
      const tenantId = maya!.tenantId;
      const added = ADDED.map((a) => ({ ...a, id: PersonId.generate() }));
      yield* db.insert(schema.person).values(
        added.map((a) => ({
          id: a.id,
          tenantId,
          email: `${a.name.toLowerCase().replace(' ', '.')}@northwind.example`,
          displayName: a.name,
        })),
      );
      yield* db.insert(schema.roleGrant).values(
        added.map((a) => ({
          id: RoleGrantId.generate(),
          tenantId,
          personId: a.id,
          role: a.grant,
          validFrom: '2025-01-01' as IsoDate,
          source: 'seed',
        })),
      );

      // Control: Maya's coach and leader do see her progress.
      for (const insider of ['Maya Chen', 'Sam Rivera', 'Leo Okonkwo']) {
        yield* signInAs(insider);
        const profile = yield* api.people.profile({ params: { id: mayaId } });
        assert.isTrue(profile.developmentVisible, insider);
        assert.isNotEmpty(profile.progress, insider);
      }

      // Grace is a colleague with no relationship to Maya.
      for (const outsider of ['Grace Liu', ...ADDED.map((a) => a.name)]) {
        yield* signInAs(outsider);
        const profile = yield* api.people.profile({ params: { id: mayaId } });
        assert.isFalse(profile.developmentVisible, outsider);
        assert.deepStrictEqual(profile.progress, [], outsider);
        assert.isNotEmpty(profile.badges, `${outsider}: earned badges stay visible to everyone`);
        const coaching = yield* api.support.coaching();
        const aboutMaya = [...coaching.asCoach, ...coaching.asCoachee].filter(
          (e) => e.coachee.id === mayaId || e.row?.person.id === mayaId,
        );
        assert.deepStrictEqual(aboutMaya, [], outsider);
      }
    }),
  );

  it.effect(
    'the profile offers each possible direction, and proposing enforces the same rules',
    () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        const api = yield* client;
        const db = yield* Db;
        const samId = yield* signInAs('Sam Rivera');
        const jordanId = yield* signInAs('Jordan Blake');
        const graceId = yield* signInAs('Grace Liu');
        const mayaId = yield* signInAs('Maya Chen');
        const directions = (viewer: string, of: PersonId) =>
          signInAs(viewer).pipe(
            Effect.andThen(api.people.profile({ params: { id: of } })),
            Effect.map((p) => p.coachingDirections),
          );

        // Two coaches with no engagement: both directions, from either side.
        assert.deepStrictEqual(yield* directions('Sam Rivera', jordanId), [
          'coach_them',
          'coach_me',
        ]);
        assert.deepStrictEqual(yield* directions('Jordan Blake', samId), [
          'coach_them',
          'coach_me',
        ]);
        // Not a coach, toward a coach: only being coached. Neither a coach: nothing.
        assert.deepStrictEqual(yield* directions('Maya Chen', jordanId), ['coach_me']);
        assert.deepStrictEqual(yield* directions('Maya Chen', graceId), []);

        // A coach asks another coach to coach them.
        yield* signInAs('Sam Rivera');
        const proposed = yield* api.support.proposeEngagement({
          payload: { coachId: jordanId, coacheeId: samId, note: 'Help me run better huddles.' },
        });
        assert.strictEqual(proposed.status, 'proposed');
        assert.strictEqual(proposed.coach.id, jordanId);
        // The pair now has a live engagement: neither direction is offered, and the
        // reverse proposal is refused as a conflict.
        assert.deepStrictEqual(yield* directions('Sam Rivera', jordanId), []);
        assert.deepStrictEqual(yield* directions('Jordan Blake', samId), []);
        const reverse = yield* api.support
          .proposeEngagement({ payload: { coachId: jordanId, coacheeId: samId, note: null } })
          .pipe(Effect.flip);
        assert.strictEqual(reverse._tag, 'Conflict');
        yield* signInAs('Jordan Blake');
        const reciprocal = yield* api.support
          .proposeEngagement({ payload: { coachId: samId, coacheeId: jordanId, note: null } })
          .pipe(Effect.flip);
        assert.strictEqual(reciprocal._tag, 'Conflict');

        // A leader who holds the coach grant is not offered, and cannot propose, coaching
        // their own direct report.
        const leoId = yield* signInAs('Leo Okonkwo');
        const [leo] = yield* db.select().from(schema.person).where(eq(schema.person.id, leoId));
        yield* db.insert(schema.roleGrant).values({
          id: RoleGrantId.generate(),
          tenantId: leo!.tenantId,
          personId: leoId,
          role: 'coach',
          validFrom: '2025-01-01' as IsoDate,
          source: 'seed',
        });
        assert.deepStrictEqual(yield* directions('Leo Okonkwo', mayaId), []);
        assert.deepStrictEqual(yield* directions('Leo Okonkwo', graceId), ['coach_them']);
        const ownReport = yield* api.support
          .proposeEngagement({ payload: { coachId: leoId, coacheeId: mayaId, note: null } })
          .pipe(Effect.flip);
        assert.strictEqual(ownReport._tag, 'Unprocessable');
      }),
  );

  it.effect('two coaches proposing to each other at once: one proposal, one Conflict', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const db = yield* Db;
      // The two people added by the first test, now both coaches with no relationship.
      const people = yield* db
        .select()
        .from(schema.person)
        .where(inArray(schema.person.displayName, ['Pia Lund', 'Ada Ruiz']))
        .orderBy(schema.person.displayName);
      const [ada, pia] = people;
      if (!ada || !pia) return yield* Effect.die('the first test adds Pia and Ada');
      yield* db.insert(schema.roleGrant).values(
        [ada, pia].map((p) => ({
          id: RoleGrantId.generate(),
          tenantId: p.tenantId,
          personId: p.id,
          role: 'coach' as const,
          validFrom: '2025-01-01' as IsoDate,
          source: 'seed',
        })),
      );
      const as = (personId: PersonId) =>
        loadActor(db, ada.tenantId, personId).pipe(Effect.map(Option.getOrThrow));
      const adaActor = yield* as(ada.id);
      const piaActor = yield* as(pia.id);
      // Each asks the other to coach them, concurrently. On PostgreSQL the pair
      // lock makes the second wait and see the first; PGlite runs them in turn.
      const outcomes = yield* Effect.all(
        [
          proposeEngagement({ coachId: pia.id, coacheeId: ada.id, note: null }).pipe(
            Effect.provideService(CurrentActor, adaActor),
          ),
          proposeEngagement({ coachId: ada.id, coacheeId: pia.id, note: null }).pipe(
            Effect.provideService(CurrentActor, piaActor),
          ),
        ].map((proposal) =>
          proposal.pipe(
            Effect.map(() => 'proposed'),
            Effect.catch((e) => Effect.succeed(e._tag)),
          ),
        ),
        { concurrency: 'unbounded' },
      );
      assert.deepStrictEqual(outcomes.toSorted(), ['Conflict', 'proposed']);
      const live = yield* db
        .select()
        .from(schema.engagement)
        .where(
          and(
            inArray(schema.engagement.coachId, [ada.id, pia.id]),
            inArray(schema.engagement.coacheeId, [ada.id, pia.id]),
          ),
        );
      assert.lengthOf(live, 1);

      // Should two proposals still cross, the database refuses the second, and the
      // use case recognises that refusal as this pair's Conflict.
      const [first] = live;
      const refused = yield* db
        .insert(schema.engagement)
        .values({
          id: EngagementId.generate(),
          tenantId: ada.tenantId,
          coachId: first!.coacheeId,
          coacheeId: first!.coachId,
          proposedById: first!.coacheeId,
          status: 'proposed',
          note: null,
          expiresAt: first!.expiresAt,
        })
        .pipe(Effect.flip);
      assert.isTrue(isUniqueViolation('engagement_live_pair_unique')(refused));
      assert.isFalse(isUniqueViolation('another_index')(refused));
    }),
  );
});
