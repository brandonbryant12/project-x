import * as PgliteClient from '@effect/sql-pglite/PgliteClient';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { assert, layer } from '@effect/vitest';
import {
  DEFAULT_CREDIT_POLICY,
  badgeCriteriaFor,
  criteriaFromSnapshot,
  evaluateBadge,
  readStoredCreditPolicy,
  type BadgeAwardId,
  type BadgeCriteria,
  type BadgeLevel,
  type CreditFact,
  type CreditId,
  type CreditRole,
  type Level,
  type ObservationId,
  type ObservationMode,
} from '@repo/domain';
import * as PgliteDrizzle from 'drizzle-orm/effect-pglite';
import { migrate as migratePglite } from 'drizzle-orm/effect-pglite/migrator';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { migrate as migratePg } from 'drizzle-orm/effect-postgres/migrator';
import { asc, eq } from 'drizzle-orm';
import { Cause, Context, Effect, Exit, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultMigrationsFolder, schema, type Database } from './index.ts';
import { layerPostgresScratchClient } from './testing.ts';

/**
 * Weighted credit migrates a live database without rewriting history
 * (design 2026-11-17 rev. 3, §2, §3, "legacy equivalence"). Builds a database
 * at the two migrations that existed before points, writes the rows a pilot
 * would hold (non-default legacy settings included), applies the new
 * migrations, and proves that legacy rows read as specified, that award and
 * revocation decisions over the legacy-only ledger are the same as the old
 * rule's, that the append-only ledger and frozen ratings still refuse
 * mutation, and that a legacy value the policy cannot represent fails the
 * migration loudly. Then, at the migrations that introduced points, it
 * writes an individual value and a pair of engagements in both directions
 * (one ended), and proves the next migration dates the value and keeps the
 * engagements.
 *
 * Runs on PGlite, or on a scratch database on real PostgreSQL when
 * `TEST_DATABASE_URL` is set (the Postgres lane). The migrator cannot stop at
 * an intermediate migration, so the test copies the earlier migration folders
 * to a scratch directory, migrates from there, then migrates again from the
 * real folder (the migrator applies only the migrations it has not recorded).
 */
const LEGACY_MIGRATIONS = ['20261117114331_init', '20261117114337_integrity'];
const POINTS_MIGRATIONS = [
  ...LEGACY_MIGRATIONS,
  '20261117125514_credit_points',
  '20261117125515_credit_integrity',
];

const folderOf = (names: ReadonlyArray<string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-migrations-'));
  for (const name of names) {
    cpSync(join(defaultMigrationsFolder, name), join(dir, name), { recursive: true });
  }
  return dir;
};
const legacyFolder = folderOf(LEGACY_MIGRATIONS);
const pointsFolder = folderOf(POINTS_MIGRATIONS);

/** Rows written under the points migrations, before values were dated. */
const POINTS_ROWS = `
update activity_skill set points_override = 15, points_override_by_id = 'per_sam' where skill_id = 'skl_a';
insert into engagement (id, tenant_id, coach_id, coachee_id, proposed_by_id, status, accepted_on, ended_on) values
  ('eng_2', 'ten_tuned', 'per_ada', 'per_sam', 'per_ada', 'ended', '2026-01-01', '2026-02-01');
`;

/** A database the test migrates itself, on either driver. */
class Migrations extends Context.Service<
  Migrations,
  { readonly db: Database; readonly from: (folder: string) => Effect.Effect<void, unknown> }
>()('test/Migrations') {}

const pgliteHarness = Layer.effect(
  Migrations,
  Effect.gen(function* () {
    const db = yield* PgliteDrizzle.makeWithDefaults();
    return {
      db: db as unknown as Database,
      from: (folder: string) => migratePglite(db, { migrationsFolder: folder }),
    };
  }),
).pipe(Layer.provideMerge(PgliteClient.layer({ extensions: { btree_gist } })), Layer.orDie);

const postgresHarness = (adminUrl: string) =>
  Layer.effect(
    Migrations,
    Effect.gen(function* () {
      const db = yield* PgDrizzle.makeWithDefaults();
      return { db, from: (folder: string) => migratePg(db, { migrationsFolder: folder }) };
    }),
  ).pipe(Layer.provideMerge(layerPostgresScratchClient(adminUrl)), Layer.orDie);

const Harness: Layer.Layer<Migrations | SqlClient.SqlClient> = process.env['TEST_DATABASE_URL']
  ? postgresHarness(process.env['TEST_DATABASE_URL'])
  : pgliteHarness;

/** Tuned: one piece of work, one observer, zero days. Partial: only minObservers set. */
const TUNED = { minDemonstrations: 1, minObservers: 1, minFirstHandShare: 0.5, minSpanDays: 0 };
const PARTIAL = { minObservers: 1 };
/** What the old code used for an absent key. */
const OLD_DEFAULTS = {
  minDemonstrations: 3,
  minObservers: 2,
  minFirstHandShare: 0.5,
  minSpanDays: 28,
};
type Legacy = typeof OLD_DEFAULTS;
const snapshot = JSON.stringify({
  thresholds: TUNED,
  measured: { demonstrations: 1 },
  firstDemonstratedOn: '2026-06-01',
  lastDemonstratedOn: '2026-06-01',
});

const LEGACY_ROWS = `
insert into tenant (id, name, slug, settings) values
  ('ten_tuned', 'Tuned', 'tuned', '{"badgeCriteria":${JSON.stringify(TUNED)},"observationWindowDays":7,"groupGrants":{"g1":"coach"}}'),
  ('ten_partial', 'Partial', 'partial', '{"badgeCriteria":${JSON.stringify(PARTIAL)}}'),
  ('ten_plain', 'Plain', 'plain', '{"observationWindowDays":10}');
insert into person (id, tenant_id, email, display_name) values
  ('per_ada', 'ten_tuned', 'ada@x.test', 'Ada'),
  ('per_leo', 'ten_tuned', 'leo@x.test', 'Leo'),
  ('per_sam', 'ten_tuned', 'sam@x.test', 'Sam');
insert into reporting_line (id, tenant_id, manager_id, report_id, valid_from) values
  ('rln_1', 'ten_tuned', 'per_leo', 'per_ada', '2026-01-01');
insert into engagement (id, tenant_id, coach_id, coachee_id, proposed_by_id, status, accepted_on) values
  ('eng_1', 'ten_tuned', 'per_sam', 'per_ada', 'per_ada', 'active', '2026-01-01');
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
insert into activity_skill (tenant_id, activity_id, skill_id, position) values
  ('ten_tuned', 'act_1', 'skl_b', 0),
  ('ten_tuned', 'act_1', 'skl_a', 0);
insert into interaction (id, tenant_id, activity_id, owner_id, logged_by_id, occurred_on, kind) values
  ('int_1', 'ten_tuned', 'act_1', 'per_ada', 'per_ada', '2026-06-01', 'client_meeting'),
  ('int_2', 'ten_tuned', 'act_1', 'per_ada', 'per_ada', '2026-06-20', 'client_meeting'),
  ('int_3', 'ten_tuned', 'act_1', 'per_ada', 'per_ada', '2026-06-10', 'client_meeting'),
  ('int_4', 'ten_tuned', 'act_1', 'per_ada', 'per_ada', '2026-07-15', 'client_meeting');
insert into observation (id, tenant_id, interaction_id, subject_id, observer_id, requested_by_id,
    basis, basis_reporting_line_id, basis_engagement_id, mode, status, due_at) values
  ('obs_1', 'ten_tuned', 'int_1', 'per_ada', 'per_leo', 'per_ada', 'leader', 'rln_1', null, 'saw_it', 'drafting', now()),
  ('obs_3', 'ten_tuned', 'int_3', 'per_ada', 'per_sam', 'per_ada', 'coach', null, 'eng_1', 'discussed', 'drafting', now()),
  ('obs_4', 'ten_tuned', 'int_1', 'per_ada', 'per_sam', 'per_ada', 'coach', null, 'eng_1', 'reviewed_work', 'drafting', now()),
  ('obs_5', 'ten_tuned', 'int_4', 'per_ada', 'per_leo', 'per_ada', 'leader', 'rln_1', null, 'saw_it', 'drafting', now());
insert into observation_rating (tenant_id, observation_id, skill_id, skill_version_id, level, position) values
  ('ten_tuned', 'obs_1', 'skl_a', 'skv_a', 3, 0),
  ('ten_tuned', 'obs_1', 'skl_b', 'skv_b', 2, 1),
  ('ten_tuned', 'obs_3', 'skl_a', 'skv_a', 3, 0),
  ('ten_tuned', 'obs_4', 'skl_a', 'skv_a', 2, 0),
  ('ten_tuned', 'obs_5', 'skl_a', 'skv_a', 2, 0),
  ('ten_tuned', 'obs_5', 'skl_b', 'skv_b', 3, 1);
update observation set status = 'signed', signed_at = now(), narrative_saw = 'Saw it',
  content_digest = 'digest' where id in ('obs_1', 'obs_3', 'obs_4', 'obs_5');
insert into credit_entry (id, tenant_id, person_id, skill_id, observation_id, interaction_id,
    observer_id, skill_version_id, level, mode, is_first_hand, demonstrated_on, policy_version) values
  ('crd_a1', 'ten_tuned', 'per_ada', 'skl_a', 'obs_1', 'int_1', 'per_leo', 'skv_a', 3, 'saw_it', true, '2026-06-01', 'scoring/2026-11-16.2'),
  ('crd_b1', 'ten_tuned', 'per_ada', 'skl_b', 'obs_1', 'int_1', 'per_leo', 'skv_b', 2, 'saw_it', true, '2026-06-01', 'scoring/2026-11-16.2'),
  ('crd_a3', 'ten_tuned', 'per_ada', 'skl_a', 'obs_3', 'int_3', 'per_sam', 'skv_a', 3, 'discussed', false, '2026-06-10', 'scoring/2026-11-16.2'),
  ('crd_a4', 'ten_tuned', 'per_ada', 'skl_a', 'obs_4', 'int_1', 'per_sam', 'skv_a', 2, 'reviewed_work', true, '2026-06-01', 'scoring/2026-11-16.2'),
  ('crd_a5', 'ten_tuned', 'per_ada', 'skl_a', 'obs_5', 'int_4', 'per_leo', 'skv_a', 2, 'saw_it', true, '2026-07-15', 'scoring/2026-11-16.2'),
  ('crd_b5', 'ten_tuned', 'per_ada', 'skl_b', 'obs_5', 'int_4', 'per_leo', 'skv_b', 3, 'saw_it', true, '2026-07-15', 'scoring/2026-11-16.2');
insert into badge_award (id, tenant_id, person_id, skill_id, level, status, criteria, policy_version,
    triggering_observation_id, awarded_at) values
  ('bdg_1', 'ten_tuned', 'per_ada', 'skl_a', 2, 'awarded', '${snapshot}', 'scoring/2026-11-16.2', 'obs_1', now()),
  ('bdg_2', 'ten_tuned', 'per_ada', 'skl_a', 3, 'awarded', '${snapshot}', 'scoring/2026-11-16.2', 'obs_1', now());
insert into badge_award_credit (tenant_id, badge_award_id, credit_entry_id) values
  ('ten_tuned', 'bdg_1', 'crd_a1'),
  ('ten_tuned', 'bdg_2', 'crd_a1');
insert into observation (id, tenant_id, interaction_id, subject_id, observer_id, requested_by_id,
    basis, basis_reporting_line_id, mode, status, due_at) values
  ('obs_2', 'ten_tuned', 'int_2', 'per_ada', 'per_leo', 'per_ada', 'leader', 'rln_1', 'saw_it', 'requested', now());
insert into observation_rating (tenant_id, observation_id, skill_id, skill_version_id, level, position) values
  ('ten_tuned', 'obs_2', 'skl_b', 'skv_b', null, 0),
  ('ten_tuned', 'obs_2', 'skl_a', 'skv_a', null, 1);
`;

const statements = (text: string) => text.split(/;\s*\n/).filter((s) => s.trim());

const refused = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => false),
    Effect.catch(() => Effect.succeed(true)),
  );

/** The badge rule before points (scoring/2026-11-16.2), kept here as the oracle. */
const oldRuleMet = (credits: ReadonlyArray<CreditFact>, level: BadgeLevel, old: Legacy) => {
  const atLevel = credits.filter((c) => c.level >= level);
  const demonstrations = new Set(atLevel.map((c) => c.interactionId)).size;
  const observers = new Set(atLevel.map((c) => c.observerId)).size;
  const firstHand = new Set(
    atLevel.filter((c) => c.mode !== 'discussed').map((c) => c.interactionId),
  ).size;
  const needed = Math.max(
    1,
    Math.ceil(Math.max(demonstrations, old.minDemonstrations) * old.minFirstHandShare),
  );
  const dates = atLevel.map((c) => Date.parse(c.demonstratedOn)).toSorted((a, b) => a - b);
  const span = dates.length ? Math.round(((dates.at(-1) ?? 0) - (dates[0] ?? 0)) / 86_400_000) : 0;
  return (
    demonstrations >= old.minDemonstrations &&
    observers >= old.minObservers &&
    firstHand >= needed &&
    span >= old.minSpanDays
  );
};

/** Every subset of a ledger: each is the net ledger after some set of voids. */
const subsets = <A>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  items.reduce<Array<Array<A>>>((all, item) => [...all, ...all.map((s) => [...s, item])], [[]]);

const converted = (old: Legacy) => ({
  ...DEFAULT_CREDIT_POLICY,
  version: 1,
  badgePoints: old.minDemonstrations * 10,
  minInteractions: old.minDemonstrations,
  minObservers: old.minObservers,
  minFirstHandShare: old.minFirstHandShare,
  minSpanDays: old.minSpanDays,
});

layer(Harness, { timeout: 120_000 })('migration to weighted credit', (it) => {
  it.effect(
    'legacy rows convert as specified; decisions are unchanged; the ledger stays frozen',
    () =>
      Effect.gen(function* () {
        const { db, from } = yield* Migrations;
        const sql = yield* SqlClient.SqlClient;
        yield* from(legacyFolder);
        for (const statement of statements(LEGACY_ROWS)) yield* sql.unsafe(statement);
        yield* from(pointsFolder);
        for (const statement of statements(POINTS_ROWS)) yield* sql.unsafe(statement);
        yield* from(defaultMigrationsFolder);

        // Every tenant holds a complete policy, version 1. Legacy criteria convert
        // exactly, minima of one and a zero-day span included; an absent key takes
        // the old code's value; the old key stays, unused; other settings untouched.
        const tenants = yield* db.select().from(schema.tenant).orderBy(asc(schema.tenant.id));
        assert.deepStrictEqual(
          tenants.map((t) => [t.id, t.settings]),
          [
            [
              'ten_partial',
              { badgeCriteria: PARTIAL, creditPolicy: converted({ ...OLD_DEFAULTS, ...PARTIAL }) },
            ],
            ['ten_plain', { observationWindowDays: 10, creditPolicy: converted(OLD_DEFAULTS) }],
            [
              'ten_tuned',
              {
                badgeCriteria: TUNED,
                creditPolicy: converted(TUNED),
                observationWindowDays: 7,
                groupGrants: { g1: 'coach' },
              },
            ],
          ] as Array<unknown>,
        );
        const policyOf = (id: string) => {
          const reading = readStoredCreditPolicy(
            tenants.find((t) => t.id === id)?.settings.creditPolicy,
          );
          if (!reading.ok) throw new Error(`the converted policy of ${id} is not valid`);
          return reading.policy;
        };

        // Roles on template and activity skills come from rank (position, skill id).
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
        // An individual value stored before values were dated takes the time of
        // the migration, so it reaches only work from then on (I38).
        assert.deepStrictEqual(
          activitySkills.map((s) => [
            s.skillId,
            s.role,
            s.pointsOverride,
            s.templatePoints,
            s.pointsOverrideAt !== null,
          ]),
          [
            ['skl_a', 'primary', 15, null, true],
            ['skl_b', 'secondary', null, null, false],
          ],
        );
        // An ended engagement in the other direction is legal and kept (I45).
        const engagements = yield* db
          .select({ id: schema.engagement.id, status: schema.engagement.status })
          .from(schema.engagement)
          .orderBy(asc(schema.engagement.id));
        assert.deepStrictEqual(
          engagements.map((e) => [e.id, e.status]),
          [
            ['eng_1', 'active'],
            ['eng_2', 'ended'],
          ],
        );

        // Legacy credits and signed ratings carry no role, are worth 10 and are
        // marked legacy; the open request's ratings follow the one-primary rule.
        const credits = yield* db.select().from(schema.creditEntry);
        assert.lengthOf(credits, 6);
        assert.isTrue(
          credits.every(
            (c) => c.role === 'unclassified' && c.points === 10 && c.pointsSource === 'legacy',
          ),
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
            ['obs_1', 'skl_a', 'unclassified'],
            ['obs_1', 'skl_b', 'unclassified'],
            ['obs_2', 'skl_b', 'primary'],
            ['obs_2', 'skl_a', 'secondary'],
            ['obs_3', 'skl_a', 'unclassified'],
            ['obs_4', 'skl_a', 'unclassified'],
            ['obs_5', 'skl_a', 'unclassified'],
            ['obs_5', 'skl_b', 'unclassified'],
          ],
        );

        // An award's legacy snapshot reads deterministically from its own numbers.
        const awards = yield* db.select().from(schema.badgeAward);
        const [award] = awards.filter((a) => a.id === ('bdg_1' as BadgeAwardId));
        assert.deepStrictEqual(criteriaFromSnapshot(award?.criteria.thresholds ?? {}), {
          ok: true,
          criteria: {
            badgePoints: 10,
            minInteractions: 1,
            minObservers: 1,
            minFirstHandShare: 0.5,
            minSpanDays: 0,
            minPrimaryPoints: 0,
          } satisfies BadgeCriteria,
        });

        // Award and revocation decisions over the legacy-only ledger: every subset
        // of each skill's credits (the net ledger after any set of voids), at
        // each level, decides as the old rule did. Awarding uses each tenant's
        // converted policy against its legacy settings; revoking uses the award's
        // own snapshot, which is the tenant's settings as they stood.
        const facts = credits.map((r): CreditFact & { skillId: string } => ({
          id: r.id,
          skillId: r.skillId,
          interactionId: r.interactionId,
          observerId: r.observerId,
          level: r.level as Level,
          mode: r.mode as ObservationMode,
          demonstratedOn: r.demonstratedOn,
          points: r.points,
          role: r.role as CreditRole,
        }));
        const settings = [
          ['ten_tuned', TUNED],
          ['ten_partial', { ...OLD_DEFAULTS, ...PARTIAL }],
          ['ten_plain', OLD_DEFAULTS],
        ] as const;
        const outcomes = new Set<boolean>();
        const decide = (net: ReadonlyArray<CreditFact>, skillId: string, level: BadgeLevel) => {
          for (const [tenantId, old] of settings) {
            const now = evaluateBadge(net, level, badgeCriteriaFor(policyOf(tenantId))).met;
            assert.strictEqual(
              now,
              oldRuleMet(net, level, old),
              `${tenantId} ${skillId} L${level}`,
            );
            outcomes.add(now);
          }
          const held = awards.find((a) => a.skillId === skillId && a.level === level);
          const reading = held ? criteriaFromSnapshot(held.criteria.thresholds) : undefined;
          if (reading && !reading.ok) throw new Error('legacy snapshot unreadable');
          if (reading?.ok) {
            assert.strictEqual(
              evaluateBadge(net, level, reading.criteria).met,
              oldRuleMet(net, level, TUNED),
            );
          }
        };
        for (const skillId of ['skl_a', 'skl_b']) {
          for (const net of subsets(facts.filter((f) => f.skillId === skillId))) {
            decide(net, skillId, 2);
            decide(net, skillId, 3);
          }
        }
        assert.strictEqual(outcomes.size, 2, 'both decisions occur');

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
              .where(eq(schema.creditEntry.id, 'crd_a1' as CreditId)),
          ),
        );
        assert.isTrue(
          yield* refused(
            db.delete(schema.creditEntry).where(eq(schema.creditEntry.id, 'crd_a1' as CreditId)),
          ),
        );
        assert.isTrue(
          yield* refused(
            db
              .update(schema.observationRating)
              .set({ role: 'primary' })
              .where(eq(schema.observationRating.observationId, 'obs_1' as ObservationId)),
          ),
        );
        assert.isTrue(yield* refused(sql.unsafe(`delete from badge_award_credit`)));
      }),
  );
});

layer(Harness, { timeout: 120_000 })('a legacy value the policy cannot represent', (it) => {
  it.effect('fails the migration loudly, naming the tenant, and changes nothing', () =>
    Effect.gen(function* () {
      const { db, from } = yield* Migrations;
      const sql = yield* SqlClient.SqlClient;
      yield* from(legacyFolder);
      yield* sql.unsafe(
        `insert into tenant (id, name, slug, settings) values ('ten_bad', 'Bad', 'bad', '{"badgeCriteria":{"minObservers":-1}}')`,
      );
      const exit = yield* Effect.exit(from(defaultMigrationsFolder));
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) assert.match(Cause.pretty(exit.cause), /ten_bad[^]*minObservers/);
      const [tenant] = yield* db.select().from(schema.tenant);
      assert.deepStrictEqual(tenant?.settings, { badgeCriteria: { minObservers: -1 } } as unknown);
      // The migrator applies pending migrations in one transaction: the columns the
      // failed migration added before it stopped are gone too.
      const added = yield* sql<{ column_name: string }>`
        select column_name from information_schema.columns
        where table_name = 'skill' and column_name = 'primary_points'`;
      assert.lengthOf(added, 0);
    }),
  );
});
