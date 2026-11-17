import * as PgliteClient from '@effect/sql-pglite/PgliteClient';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { assert, layer } from '@effect/vitest';
import {
  DEFAULT_CREDIT_POLICY,
  criteriaFromSnapshot,
  resolveCreditPolicy,
  validateCreditPolicy,
  type BadgeCriteria,
  type CreditId,
  type ObservationId,
} from '@repo/domain';
import * as PgliteDrizzle from 'drizzle-orm/effect-pglite';
import { migrate } from 'drizzle-orm/effect-pglite/migrator';
import { asc, eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultMigrationsFolder, schema } from './index.ts';

/**
 * Weighted credit migrates a live database without rewriting history
 * (design 2026-11-17 §3, "legacy equivalence"). Builds a database at the two
 * migrations that existed before points, writes the rows a pilot would hold,
 * applies the new migrations, and proves that legacy rows read as specified
 * and that the append-only ledger and frozen ratings still refuse mutation.
 *
 * The migrator cannot stop at an intermediate migration, so the test copies
 * the earlier migration folders to a scratch directory, migrates from there,
 * then migrates again from the real folder (the migrator applies only the
 * migrations it has not recorded).
 */
const LEGACY_MIGRATIONS = ['20261117114331_init', '20261117114337_integrity'];

const legacyFolder = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-migrations-'));
  for (const name of LEGACY_MIGRATIONS) {
    cpSync(join(defaultMigrationsFolder, name), join(dir, name), { recursive: true });
  }
  return dir;
})();

const LEGACY_ROWS = `
insert into tenant (id, name, slug, settings) values
  ('ten_tuned', 'Tuned', 'tuned', '{"badgeCriteria":{"minDemonstrations":2,"minObservers":1,"minFirstHandShare":0.5,"minSpanDays":0},"observationWindowDays":7,"groupGrants":{"g1":"coach"}}'),
  ('ten_plain', 'Plain', 'plain', '{"observationWindowDays":10}');
insert into person (id, tenant_id, email, display_name) values
  ('per_ada', 'ten_tuned', 'ada@x.test', 'Ada'),
  ('per_leo', 'ten_tuned', 'leo@x.test', 'Leo');
insert into reporting_line (id, tenant_id, manager_id, report_id, valid_from) values
  ('rln_1', 'ten_tuned', 'per_leo', 'per_ada', '2026-01-01');
insert into skill (id, tenant_id, slug, name, summary, domain, outcome, status) values
  ('skl_a', 'ten_tuned', 'discovery', 'Discovery', 's', 'client_discovery', 'trust', 'published'),
  ('skl_b', 'ten_tuned', 'explaining', 'Explaining', 's', 'communication', 'clarity', 'published');
insert into skill_version (id, tenant_id, skill_id, number, published_at) values
  ('skv_a', 'ten_tuned', 'skl_a', 1, now()),
  ('skv_b', 'ten_tuned', 'skl_b', 1, now());
insert into activity_template (id, tenant_id, slug, name, description, kind, status) values
  ('atp_1', 'ten_tuned', 'discovery-meeting', 'Discovery meeting', 'd', 'client_meeting', 'published');
insert into activity_template_skill (tenant_id, template_id, skill_id, position) values
  ('ten_tuned', 'atp_1', 'skl_a', 0),
  ('ten_tuned', 'atp_1', 'skl_b', 1);
insert into activity (id, tenant_id, owner_id, template_id, title, origin, status) values
  ('act_1', 'ten_tuned', 'per_ada', 'atp_1', 'Discovery', 'ad_hoc', 'underway');
-- Position is not unique: both skills at 0; the lower skill id becomes primary.
insert into activity_skill (tenant_id, activity_id, skill_id, position) values
  ('ten_tuned', 'act_1', 'skl_b', 0),
  ('ten_tuned', 'act_1', 'skl_a', 0);
insert into interaction (id, tenant_id, activity_id, owner_id, logged_by_id, occurred_on, kind) values
  ('int_1', 'ten_tuned', 'act_1', 'per_ada', 'per_ada', '2026-06-01', 'client_meeting'),
  ('int_2', 'ten_tuned', 'act_1', 'per_ada', 'per_ada', '2026-06-20', 'client_meeting');
insert into observation (id, tenant_id, interaction_id, subject_id, observer_id, requested_by_id,
    basis, basis_reporting_line_id, mode, status, due_at) values
  ('obs_1', 'ten_tuned', 'int_1', 'per_ada', 'per_leo', 'per_ada', 'leader', 'rln_1', 'saw_it', 'drafting', now());
insert into observation_rating (tenant_id, observation_id, skill_id, skill_version_id, level, position) values
  ('ten_tuned', 'obs_1', 'skl_a', 'skv_a', 3, 0),
  ('ten_tuned', 'obs_1', 'skl_b', 'skv_b', 2, 1);
update observation set status = 'signed', signed_at = now(), narrative_saw = 'Saw it',
  content_digest = 'digest' where id = 'obs_1';
insert into credit_entry (id, tenant_id, person_id, skill_id, observation_id, interaction_id,
    observer_id, skill_version_id, level, mode, is_first_hand, demonstrated_on, policy_version) values
  ('crd_a', 'ten_tuned', 'per_ada', 'skl_a', 'obs_1', 'int_1', 'per_leo', 'skv_a', 3, 'saw_it', true, '2026-06-01', 'scoring/2026-11-16.2'),
  ('crd_b', 'ten_tuned', 'per_ada', 'skl_b', 'obs_1', 'int_1', 'per_leo', 'skv_b', 2, 'saw_it', true, '2026-06-01', 'scoring/2026-11-16.2');
insert into badge_award (id, tenant_id, person_id, skill_id, level, status, criteria, policy_version,
    triggering_observation_id, awarded_at) values
  ('bdg_1', 'ten_tuned', 'per_ada', 'skl_a', 2, 'awarded',
   '{"thresholds":{"minDemonstrations":2,"minObservers":1,"minFirstHandShare":0.5,"minSpanDays":0},"measured":{"demonstrations":2},"firstDemonstratedOn":"2026-06-01","lastDemonstratedOn":"2026-06-01"}',
   'scoring/2026-11-16.2', 'obs_1', now());
insert into badge_award_credit (tenant_id, badge_award_id, credit_entry_id) values
  ('ten_tuned', 'bdg_1', 'crd_a');
-- An open request: its ratings are not frozen and follow the one-primary rule.
insert into observation (id, tenant_id, interaction_id, subject_id, observer_id, requested_by_id,
    basis, basis_reporting_line_id, mode, status, due_at) values
  ('obs_2', 'ten_tuned', 'int_2', 'per_ada', 'per_leo', 'per_ada', 'leader', 'rln_1', 'saw_it', 'requested', now());
insert into observation_rating (tenant_id, observation_id, skill_id, skill_version_id, level, position) values
  ('ten_tuned', 'obs_2', 'skl_b', 'skv_b', null, 0),
  ('ten_tuned', 'obs_2', 'skl_a', 'skv_a', null, 1);
`;

const PgliteLayer = PgliteClient.layer({ extensions: { btree_gist } }).pipe(Layer.orDie);

const refused = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => false),
    Effect.catch(() => Effect.succeed(true)),
  );

layer(PgliteLayer, { timeout: 60_000 })('migration to weighted credit', (it) => {
  it.effect('legacy rows read as specified, and the ledger and signed ratings stay frozen', () =>
    Effect.gen(function* () {
      const db = yield* PgliteDrizzle.makeWithDefaults();
      const sql = yield* SqlClient.SqlClient;
      yield* migrate(db, { migrationsFolder: legacyFolder });
      for (const statement of LEGACY_ROWS.split(/;\s*\n/).filter((s) => s.trim())) {
        yield* sql.unsafe(statement);
      }
      yield* migrate(db, { migrationsFolder: defaultMigrationsFolder });

      // Every tenant holds a complete policy. Legacy criteria converted and
      // clamped to the structural floors (one observer → two, zero days → one);
      // the old key stays, unused; other settings untouched.
      const tenants = yield* db.select().from(schema.tenant).orderBy(asc(schema.tenant.id));
      const legacyCriteria = {
        minDemonstrations: 2,
        minObservers: 1,
        minFirstHandShare: 0.5,
        minSpanDays: 0,
      };
      assert.deepStrictEqual(
        tenants.map((t) => t.settings),
        [
          { observationWindowDays: 10, creditPolicy: DEFAULT_CREDIT_POLICY },
          {
            badgeCriteria: legacyCriteria,
            creditPolicy: {
              ...DEFAULT_CREDIT_POLICY,
              badgePoints: 20,
              minInteractions: 2,
              minObservers: 2,
              minFirstHandShare: 0.5,
              minSpanDays: 1,
            },
            observationWindowDays: 7,
            groupGrants: { g1: 'coach' },
          },
        ] as Array<unknown>,
      );
      for (const t of tenants) {
        assert.deepStrictEqual(
          validateCreditPolicy(resolveCreditPolicy(t.settings.creditPolicy)),
          [],
        );
        assert.deepStrictEqual(
          resolveCreditPolicy(t.settings.creditPolicy),
          t.settings.creditPolicy,
        );
      }

      // Roles on template and activity skills come from position.
      const templateSkills = yield* db
        .select()
        .from(schema.activityTemplateSkill)
        .orderBy(asc(schema.activityTemplateSkill.position));
      assert.deepStrictEqual(
        templateSkills.map((s) => [s.skillId, s.role, s.points]),
        [
          ['skl_a', 'primary', null],
          ['skl_b', 'secondary', null],
        ],
      );
      const activitySkills = yield* db
        .select()
        .from(schema.activitySkill)
        .orderBy(asc(schema.activitySkill.skillId));
      assert.deepStrictEqual(
        activitySkills.map((s) => [s.skillId, s.role, s.pointsOverride, s.templatePoints]),
        [
          ['skl_a', 'primary', null, null],
          ['skl_b', 'secondary', null, null],
        ],
      );

      // Legacy credits are primary, worth 10, marked legacy; legacy ratings count in full.
      const credits = yield* db
        .select()
        .from(schema.creditEntry)
        .orderBy(asc(schema.creditEntry.id));
      assert.deepStrictEqual(
        credits.map((c) => [c.id, c.role, c.points, c.pointsSource]),
        [
          ['crd_a', 'primary', 10, 'legacy'],
          ['crd_b', 'primary', 10, 'legacy'],
        ],
      );
      const ratings = yield* db
        .select()
        .from(schema.observationRating)
        .orderBy(
          asc(schema.observationRating.observationId),
          asc(schema.observationRating.position),
        );
      assert.deepStrictEqual(
        ratings.map((r) => [r.observationId, r.skillId, r.role]),
        [
          ['obs_1', 'skl_a', 'primary'],
          ['obs_1', 'skl_b', 'primary'],
          ['obs_2', 'skl_b', 'primary'],
          ['obs_2', 'skl_a', 'secondary'],
        ],
      );

      // The award's legacy snapshot reads as minDemonstrations × 10 points.
      const [award] = yield* db.select().from(schema.badgeAward);
      assert.deepStrictEqual(criteriaFromSnapshot(award?.criteria.thresholds ?? {}), {
        badgePoints: 20,
        minInteractions: 2,
        minObservers: 1,
        minFirstHandShare: 0.5,
        minSpanDays: 0,
        minPrimaryPoints: 0,
      } satisfies BadgeCriteria);

      // The legacy defaults were dropped: a new credit or rating must state its values.
      const defaults = yield* sql<{ column_name: string; column_default: string | null }>`
        select column_name, column_default from information_schema.columns
        where table_name in ('credit_entry', 'observation_rating')
          and column_name in ('role', 'points', 'points_source')`;
      assert.lengthOf(defaults, 4);
      assert.isTrue(defaults.every((c) => c.column_default === null));

      // Append-only and frozen triggers still refuse mutation after the migration.
      assert.isTrue(
        yield* refused(
          db
            .update(schema.creditEntry)
            .set({ points: 30 })
            .where(eq(schema.creditEntry.id, 'crd_a' as CreditId)),
        ),
      );
      assert.isTrue(
        yield* refused(
          db.delete(schema.creditEntry).where(eq(schema.creditEntry.id, 'crd_a' as CreditId)),
        ),
      );
      assert.isTrue(
        yield* refused(
          db
            .update(schema.observationRating)
            .set({ role: 'secondary' })
            .where(eq(schema.observationRating.observationId, 'obs_1' as ObservationId)),
        ),
      );
      assert.isTrue(yield* refused(sql.unsafe(`delete from badge_award_credit`)));
    }),
  );
});
