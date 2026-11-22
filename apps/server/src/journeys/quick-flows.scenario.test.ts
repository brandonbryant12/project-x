import { Api } from '@repo/api';
import { Db, schema } from '@repo/db';
import type { IsoDate } from '@repo/domain';
import { assert, layer } from '@effect/vitest';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: simplified POC coaching flows.
 * Verifies instant-active plans, editable active focus skills, one-shot
 * feedback requests (`requestQuick`), one-shot published observations
 * (`publishQuick`), and POC badge awards after 2 observations while preserving
 * privacy holds and observer eligibility.
 */
const client = HttpApiTest.groups(Api, [
  'observations',
  'development',
  'support',
  'catalog',
  'admin',
]);

layer(ScenarioLayer, { timeout: 60_000 })('simplified coaching flows', (it) => {
  it.effect('instant-active plan creation and editable focus skills', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const api = yield* client;
      yield* signInAs('Grace Liu');
      const skills = yield* api.catalog.skills({ query: {} });
      const first = skills[0]!;
      const second = skills[1]!;

      const plan = yield* api.development.createPlan({
        payload: {
          title: 'Build client discovery',
          intent: '',
          periodStart: '2026-11-16' as IsoDate,
          periodEnd: '2027-05-16' as IsoDate,
          focusSkills: [{ skillId: first.id, targetLevel: 2 }],
        },
      });
      assert.strictEqual(plan.status, 'active');
      assert.strictEqual(plan.focusSkills.length, 1);

      const updated = yield* api.development.updatePlan({
        params: { id: plan.id },
        payload: {
          focusSkills: [
            { skillId: first.id, targetLevel: 2 },
            { skillId: second.id, targetLevel: 3 },
          ],
        },
      });
      assert.strictEqual(updated.focusSkills.length, 2);
    }),
  );

  it.effect('one-shot requestQuick + publishQuick awards a badge in 2 observations', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      const api = yield* client;
      const graceId = yield* signInAs('Grace Liu');

      const observers = yield* api.observations.observers();
      assert.isAbove(observers.length, 0);
      const priya = observers[0]!;

      const dev = yield* api.development.mine();
      const focusSkill = dev.plan!.focusSkills[0]!.skill;

      // Privacy screening still blocks client PII on quick requests.
      const held = yield* api.observations
        .requestQuick({
          payload: {
            observerId: priya.person.id,
            skillIds: [focusSkill.id],
            kind: 'client_meeting',
            title: 'Client review',
            occurredOn: '2026-11-16' as IsoDate,
            mode: 'saw_it',
            note: 'Spoke with Mrs. Patterson about account number 4417 2291.',
          },
        })
        .pipe(Effect.flip);
      assert.strictEqual(held._tag, 'Unprocessable');

      // Clean one-shot feedback request succeeds in one call.
      const requested = yield* api.observations.requestQuick({
        payload: {
          observerId: priya.person.id,
          skillIds: [focusSkill.id],
          kind: 'client_meeting',
          title: 'New household discovery',
          occurredOn: '2026-11-16' as IsoDate,
          mode: 'saw_it',
          note: 'Focused on listening before recommending a plan.',
        },
      });
      assert.strictEqual(requested.status, 'requested');

      // Leader signs the request (observation #1).
      yield* signInAs(priya.person.displayName);
      const signed1 = yield* api.observations.sign({
        params: { id: requested.id },
        payload: {
          version: requested.version,
          mode: 'saw_it',
          ratings: [{ skillId: focusSkill.id, level: 2, indicatorIds: [], credit: true }],
          narrativeSaw: 'Grace paused and summarized the household goals clearly.',
          narrativeNext: 'Ask about timeline trade-offs next.',
        },
      });
      assert.strictEqual(signed1.status, 'signed');
      assert.strictEqual(signed1.badgesEarned.length, 0);

      // Leader publishes a second observation via publishQuick (observation #2) → badge earned!
      const signed2 = yield* api.observations.publishQuick({
        payload: {
          subjectId: graceId,
          activityId: null,
          title: 'Follow-up client call',
          occurredOn: '2026-11-16' as IsoDate,
          kind: 'client_meeting',
          mode: 'saw_it',
          ratings: [{ skillId: focusSkill.id, level: 2, indicatorIds: [], credit: true }],
          narrativeSaw: 'Grace checked in on the timeline trade-offs without rushing.',
          narrativeNext: 'Try leading the full opening independently next time.',
        },
      });
      assert.strictEqual(signed2.status, 'signed');
      assert.strictEqual(signed2.badgesEarned.length, 1);
      assert.strictEqual(signed2.badgesEarned[0]?.level, 2);

      // Development view exposes recentObservations cleanly.
      yield* signInAs('Grace Liu');
      const after = yield* api.development.mine();
      assert.isAtLeast(after.recentObservations.length, 2);
      const home = yield* api.support.home();
      assert.isAtLeast(home.progress.length, 1);
      assert.isAtLeast(home.eligibleObservers.length, 1);

      // Skill catalog exposes core/common tiers, firm signals, tags, and rare combos.
      const insights = yield* api.catalog.insights();
      assert.isAbove(insights.totalPeople, 0);
      assert.isAtLeast(insights.rareCombos.length, 1);
      assert.isAtLeast(insights.tags.length, 1);
      assert.isAtLeast(insights.lackingSkillIds.length, 1);
      const catalogCards = yield* api.catalog.skills({ query: {} });
      assert.isTrue(catalogCards.some((s) => s.tier === 'core'));
      assert.isTrue(catalogCards.some((s) => s.tier === 'common'));
      const detail = yield* api.catalog.skill({ params: { slug: focusSkill.slug } });
      assert.isAtLeast(detail.rarePairings.length, 1);

      // Tenant admin configures badge rigor policy and authors a custom skill + playbook resource.
      yield* signInAs('Rhea Castillo');
      const policy = yield* api.admin.policy();
      assert.strictEqual(policy.preset, 'poc');
      assert.isTrue(policy.canEdit);
      const updatedPolicy = yield* api.admin.updatePolicy({
        payload: {
          badgeCriteria: {
            minDemonstrations: 3,
            minObservers: 2,
            minFirstHandShare: 0.5,
            minSpanDays: 28,
          },
          observationWindowDays: 21,
          reason: 'Move pilot cohort to enterprise rigor',
        },
      });
      assert.strictEqual(updatedPolicy.preset, 'strict');
      assert.strictEqual(updatedPolicy.observationWindowDays, 21);

      const authored = yield* api.catalog.createSkill({
        payload: {
          name: 'Estate transition readiness',
          domain: 'planning_advice',
          tier: 'common',
          summary: 'Guides multi-generational households cleanly through wealth transfer planning.',
          outcome: 'Multi-gen retention',
          tags: ['estate', 'households'],
          levels: [
            {
              level: 1,
              summary: 'Gathers estate documents with support.',
              indicators: ['Lists existing wills and beneficiaries'],
            },
            {
              level: 2,
              summary: 'Frames transfer goals in plain terms.',
              indicators: ['Walks through beneficiary trade-offs clearly'],
            },
            {
              level: 3,
              summary: 'Leads family transition meetings independently.',
              indicators: ['Aligns heirs and spouses on shared priorities'],
            },
            {
              level: 4,
              summary: 'Coaches peers on complex estate conversations.',
              indicators: ['Debriefs family meetings with colleagues'],
            },
          ],
        },
      });
      assert.strictEqual(authored.version, 1);
      assert.strictEqual(authored.tier, 'common');

      const withResource = yield* api.catalog.addResource({
        params: { id: authored.id },
        payload: {
          level: 3,
          kind: 'playbook',
          title: 'Family meeting agenda template',
          summary: 'A 45-minute structure for inviting adult children into the conversation.',
          url: 'https://playbook.northwind.example/estate-meeting',
          durationMinutes: 10,
        },
      });
      assert.strictEqual(withResource.resources.length, 1);
      const resId = withResource.resources[0]?.id;
      assert.isDefined(resId);
      const afterRemove = yield* api.catalog.removeResource({
        params: { id: authored.id, resourceId: resId },
      });
      assert.strictEqual(afterRemove.resources.length, 0);

      // Verify the Postgres @alchemy.run/domain event journal captured all core domain facts with zero PII.
      const db = yield* Db;
      const journaled = yield* db.select().from(schema.domainEvent);
      const tags = new Set(journaled.map((row) => row.eventTag));
      for (const expectedTag of [
        'ObservationSigned',
        'DemonstrationRecorded',
        'BadgeAwarded',
        'TenantPolicyUpdated',
        'SkillPublished',
        'PlaybookResourceAttached',
        'PlaybookResourceRemoved',
      ]) {
        assert.isTrue(tags.has(expectedTag), `expected domain_event tag ${expectedTag}`);
      }
      const serialized = JSON.stringify(journaled);
      assert.isFalse(serialized.includes('Grace paused'));
      assert.isFalse(serialized.includes('Mrs. Patterson'));
      assert.isFalse(serialized.includes('4417 2291'));
    }),
  );
});
