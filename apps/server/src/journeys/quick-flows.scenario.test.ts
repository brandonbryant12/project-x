import { Api } from '@repo/api';
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
const client = HttpApiTest.groups(Api, ['observations', 'development', 'support', 'catalog']);

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
    }),
  );
});
