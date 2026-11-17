import { Api } from '@repo/api';
import type { PlanId, SkillId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, count, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { addDaysIso, today } from '../platform/time.ts';
import { runSweeps } from '../scheduler/sweeps.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';
import { OUTSIDER, seedSecondTenant } from '../test/second-tenant.ts';

/**
 * Journey: a plan is changed, revised, agreed again, reviewed and closed
 * (design 2026-11-17 §8). Protects: a closed plan is never edited and only its
 * owner edits an open one; a revision of an agreed plan clears the agreement,
 * the endorsement and a review that is not confirmed, and the plan can be
 * agreed again; a confirmed review is fixed and stops revision; the closing
 * review is recorded by the owner, confirmed by an agreer and never writes
 * credit or a badge; unfinished plans past their period expire, drafts
 * included, whether or not a review is recorded, and the review survives
 * expiry. Every plan write names the version the person saw: agreeing to or
 * confirming a plan that changed since is refused (Conflict). The tests share
 * one seeded tenant and run in order.
 */
const client = HttpApiTest.groups(Api, ['development']);

layer(ScenarioLayer, { timeout: 120_000 })('plan revise and review', (it) => {
  const setup = Effect.gen(function* () {
    yield* atScenarioTime;
    yield* seedWorld;
    const db = yield* Db;
    const api = yield* client;
    const ids = {
      maya: yield* signInAs('Maya Chen'),
      marcus: yield* signInAs('Marcus Hill'),
      priya: yield* signInAs('Priya Raman'),
      sam: yield* signInAs('Sam Rivera'),
    };
    const [maya] = yield* db.select().from(schema.person).where(eq(schema.person.id, ids.maya));
    const tenantId = maya?.tenantId;
    if (!tenantId) return yield* Effect.die('seeded Maya missing');
    const skills = yield* db.select().from(schema.skill).where(eq(schema.skill.tenantId, tenantId));
    const skill = (slug: string) => skills.find((s) => s.slug === slug)?.id as SkillId;
    const on = yield* today;
    const day = (offset: number) => addDaysIso(on, offset);
    /** Maya's current plan, as the named person sees it. */
    const mayaPlan = (as = 'Maya Chen') =>
      Effect.gen(function* () {
        yield* signInAs(as);
        const view = yield* api.development.of({ params: { id: ids.maya } });
        if (!view.plan) return yield* Effect.die('Maya has no current plan');
        return view.plan;
      });
    const planRow = (id: PlanId) =>
      db
        .select()
        .from(schema.plan)
        .where(eq(schema.plan.id, id))
        .pipe(Effect.map((rows) => rows[0]));
    /** The plan's current version, as a freshly loaded form would send it. */
    const versionOf = (id: PlanId) => planRow(id).pipe(Effect.map((row) => row?.version ?? -1));
    const auditOf = (id: string) =>
      db
        .select()
        .from(schema.auditEvent)
        .where(and(eq(schema.auditEvent.entityType, 'plan'), eq(schema.auditEvent.entityId, id)))
        .orderBy(schema.auditEvent.seq);
    const reviewOf = (planId: PlanId, outcome: 'achieved' | 'partly' | 'carried_over') =>
      Effect.gen(function* () {
        const plan = yield* planRow(planId);
        const focus = yield* db
          .select()
          .from(schema.planSkill)
          .where(eq(schema.planSkill.planId, planId));
        return {
          params: { id: planId },
          payload: {
            version: plan?.version ?? -1,
            outcomes: focus.map((f) => ({ skillId: f.skillId, outcome })),
            summary: `Closing ${plan?.title ?? 'plan'}: what changed in my meetings.`,
          },
        };
      });
    return { db, api, ids, tenantId, skill, day, mayaPlan, planRow, versionOf, auditOf, reviewOf };
  });

  it.effect('a closed plan is never edited, and only its owner edits an open one', () =>
    Effect.gen(function* () {
      const { api, skill, day, mayaPlan, planRow, versionOf } = yield* setup;
      const plan = yield* mayaPlan();
      assert.isTrue(plan.canEdit);
      assert.isFalse(plan.canEditFocusSkills);
      // The coach sees the plan but its words are the owner's.
      const asSam = yield* mayaPlan('Sam Rivera');
      assert.isFalse(asSam.canEdit);
      assert.isTrue(asSam.canAddWork);
      const coachEdit = yield* api.development
        .updatePlan({
          params: { id: plan.id },
          payload: { version: plan.version, title: 'Sam’s title' },
        })
        .pipe(Effect.flip);
      assert.strictEqual(coachEdit._tag, 'Forbidden');

      yield* signInAs('Maya Chen');
      const edited = yield* api.development.updatePlan({
        params: { id: plan.id },
        payload: {
          version: plan.version,
          title: 'Lead every first meeting with discovery',
          periodEnd: day(120),
        },
      });
      assert.strictEqual(edited.title, 'Lead every first meeting with discovery');
      assert.strictEqual(edited.periodEnd, day(120));
      const focusWhileActive = yield* api.development
        .updatePlan({
          params: { id: plan.id },
          payload: {
            version: edited.version,
            focusSkills: [{ skillId: skill('transparency'), targetLevel: 2 }],
          },
        })
        .pipe(Effect.flip);
      assert.strictEqual(focusWhileActive._tag, 'Unprocessable');

      // Grace's plan is canceled: nothing about it changes again, closing summary or not.
      yield* signInAs('Grace Liu');
      const grace = yield* api.development.createPlan({
        payload: {
          title: 'Know the service model',
          intent: '',
          periodStart: day(0),
          periodEnd: day(90),
          focusSkills: [{ skillId: skill('relationship-deepening'), targetLevel: 2 }],
        },
      });
      const canceled = yield* api.development.planEvent({
        params: { id: grace.id },
        payload: { event: 'CANCEL', version: grace.version },
      });
      const closed = yield* api.development
        .updatePlan({
          params: { id: grace.id },
          payload: { version: canceled.version, title: 'Rewritten after the fact' },
        })
        .pipe(Effect.flip);
      assert.strictEqual(closed._tag, 'Unprocessable');
      const withSummary = yield* api.development
        .updatePlan({
          params: { id: grace.id },
          payload: {
            version: yield* versionOf(grace.id),
            title: 'Rewritten after the fact',
            closingSummary: 'Done.',
          } as never,
        })
        .pipe(Effect.flip);
      assert.strictEqual(withSummary._tag, 'Unprocessable');
      const row = yield* planRow(grace.id);
      assert.strictEqual(row?.title, 'Know the service model');
      assert.isNull(row?.closingSummary);
    }),
  );

  it.effect(
    'revising an agreed plan clears the agreement, endorsement and an unconfirmed review; it is agreed again',
    () =>
      Effect.gen(function* () {
        const { api, ids, skill, mayaPlan, planRow, versionOf, auditOf, reviewOf } = yield* setup;
        const plan = yield* mayaPlan();
        // Her leader endorses; she records a closing review she has not had confirmed.
        yield* signInAs('Leo Okonkwo');
        yield* api.development.planEvent({
          params: { id: plan.id },
          payload: { event: 'ENDORSE', version: plan.version },
        });
        yield* signInAs('Maya Chen');
        yield* api.development.recordPlanReview(yield* reviewOf(plan.id, 'partly'));

        // The coach (an agreer) revises it back to a draft.
        const asSam = yield* mayaPlan('Sam Rivera');
        assert.include(asSam.actions, 'REVISE');
        const draft = yield* api.development.planEvent({
          params: { id: plan.id },
          payload: { event: 'REVISE', version: asSam.version },
        });
        assert.strictEqual(draft.status, 'draft');
        assert.isNull(draft.agreedBy);
        assert.isNull(draft.endorsedBy);
        assert.isNull(draft.review);
        assert.isNull(draft.closingSummary);
        assert.isTrue(draft.focusSkills.every((f) => f.outcome === null));
        const row = yield* planRow(plan.id);
        assert.isNull(row?.agreedAt);
        assert.isNull(row?.endorsedAt);
        assert.isNull(row?.reviewRecordedById);
        const events = (yield* auditOf(plan.id)).slice(-2);
        assert.deepStrictEqual(
          events.map((e) => [e.event, e.fromState, e.toState, e.actorId]),
          [
            ['REVISE', 'active', 'draft', ids.sam],
            ['REVIEW_CLEARED', null, null, ids.sam],
          ],
        );
        assert.deepStrictEqual(events[0]?.data, {
          cleared: ['agreement', 'endorsement', 'review'],
        });

        // As a draft its focus can change; then it is proposed and agreed again.
        const again = yield* mayaPlan();
        assert.isTrue(again.canEditFocusSkills);
        yield* api.development.updatePlan({
          params: { id: plan.id },
          payload: {
            version: again.version,
            focusSkills: [
              { skillId: skill('client-discovery'), targetLevel: 4 },
              { skillId: skill('behavioral-coaching'), targetLevel: 3 },
            ],
          },
        });
        const proposed = yield* api.development.planEvent({
          params: { id: plan.id },
          payload: { event: 'PROPOSE', version: yield* versionOf(plan.id) },
        });
        // Sam opens the proposal; Maya changes its end date before he agrees.
        const seenBySam = yield* mayaPlan('Sam Rivera');
        yield* signInAs('Maya Chen');
        yield* api.development.updatePlan({
          params: { id: plan.id },
          payload: { version: proposed.version, periodEnd: addDaysIso(proposed.periodEnd, 30) },
        });
        // Agreeing to the plan he saw is refused: it is no longer that plan.
        yield* signInAs('Sam Rivera');
        const stale = yield* api.development
          .planEvent({
            params: { id: plan.id },
            payload: { event: 'AGREE', version: seenBySam.version },
          })
          .pipe(Effect.flip);
        assert.strictEqual(stale._tag, 'Conflict');
        assert.strictEqual((yield* planRow(plan.id))?.status, 'proposed');
        const agreed = yield* api.development.planEvent({
          params: { id: plan.id },
          payload: { event: 'AGREE', version: (yield* mayaPlan('Sam Rivera')).version },
        });
        assert.strictEqual(agreed.status, 'active');
        assert.strictEqual(agreed.agreedBy?.id, ids.sam);
        // Level 4 stays a valid target; it is reviewed by a person, and has no badge.
        const discovery = agreed.focusSkills.find((f) => f.skill.id === skill('client-discovery'));
        assert.strictEqual(discovery?.targetLevel, 4);
        assert.isFalse(discovery?.targetHasBadge);
        assert.strictEqual(discovery?.highestObservedLevel, 3);
        assert.strictEqual(discovery?.observedAtTarget, 0);
      }),
  );

  it.effect(
    'the closing review: the owner records it until an agreer confirms it; then it is fixed',
    () =>
      Effect.gen(function* () {
        const { db, api, ids, mayaPlan, planRow, versionOf, auditOf, reviewOf } = yield* setup;
        const plan = yield* mayaPlan();
        const confirm = (version: number) =>
          api.development.confirmPlanReview({ params: { id: plan.id }, payload: { version } });
        const ledger = Effect.all([
          db.select({ n: count() }).from(schema.creditEntry),
          db.select({ n: count() }).from(schema.badgeAward),
        ]);
        const before = yield* ledger;

        // Who may record and confirm: the owner records; an agreer, never the owner, confirms.
        yield* signInAs('Sam Rivera');
        assert.strictEqual(
          (yield* api.development
            .recordPlanReview(yield* reviewOf(plan.id, 'achieved'))
            .pipe(Effect.flip))._tag,
          'Forbidden',
        );
        const nothingYet = yield* confirm(yield* versionOf(plan.id)).pipe(Effect.flip);
        assert.strictEqual(nothingYet._tag, 'Unprocessable');
        yield* signInAs('Maya Chen');
        const partial = yield* reviewOf(plan.id, 'achieved');
        const missing = yield* api.development
          .recordPlanReview({
            ...partial,
            payload: { ...partial.payload, outcomes: partial.payload.outcomes.slice(0, 1) },
          })
          .pipe(Effect.flip);
        assert.strictEqual(missing._tag, 'Unprocessable');
        yield* api.development.recordPlanReview(yield* reviewOf(plan.id, 'carried_over'));
        // Recorded again before it is confirmed: the latest stands.
        const recorded = yield* api.development.recordPlanReview(
          yield* reviewOf(plan.id, 'achieved'),
        );
        assert.isTrue(recorded.focusSkills.every((f) => f.outcome === 'achieved'));
        assert.strictEqual(recorded.review?.recordedBy.id, ids.maya);
        assert.isNull(recorded.review?.confirmedBy);
        assert.isFalse(recorded.canConfirmReview);
        assert.strictEqual((yield* confirm(recorded.version).pipe(Effect.flip))._tag, 'Forbidden');
        // Her skip-level leader is neither coach nor leader: not an agreer.
        yield* signInAs('Rhea Castillo');
        assert.strictEqual((yield* confirm(recorded.version).pipe(Effect.flip))._tag, 'Forbidden');

        // Sam reads the review; Maya records it again before he confirms. Confirming
        // what he read is refused: he confirms only the review he has seen.
        const asSam = yield* mayaPlan('Sam Rivera');
        assert.isTrue(asSam.canConfirmReview);
        yield* signInAs('Maya Chen');
        yield* api.development.recordPlanReview(yield* reviewOf(plan.id, 'achieved'));
        yield* signInAs('Sam Rivera');
        assert.strictEqual((yield* confirm(asSam.version).pipe(Effect.flip))._tag, 'Conflict');
        assert.isNull((yield* planRow(plan.id))?.reviewConfirmedAt);
        const confirmed = yield* confirm((yield* mayaPlan('Sam Rivera')).version);
        assert.strictEqual(confirmed.review?.confirmedBy?.id, ids.sam);
        assert.isFalse(confirmed.canConfirmReview);
        assert.notInclude(confirmed.actions, 'REVISE');

        // Fixed: not recorded again, not confirmed again, and the plan is no longer revised.
        yield* signInAs('Maya Chen');
        assert.isFalse((yield* mayaPlan()).canRecordReview);
        assert.strictEqual(
          (yield* api.development
            .recordPlanReview(yield* reviewOf(plan.id, 'partly'))
            .pipe(Effect.flip))._tag,
          'Unprocessable',
        );
        assert.strictEqual(
          (yield* api.development
            .planEvent({
              params: { id: plan.id },
              payload: { event: 'REVISE', version: confirmed.version },
            })
            .pipe(Effect.flip))._tag,
          'InvalidTransition',
        );
        yield* signInAs('Sam Rivera');
        assert.strictEqual(
          (yield* confirm(confirmed.version).pipe(Effect.flip))._tag,
          'Unprocessable',
        );
        assert.strictEqual((yield* planRow(plan.id))?.reviewConfirmedById, ids.sam);

        // A review is a person's judgement: it writes no credit and no badge.
        assert.deepStrictEqual(yield* ledger, before);
        const events = (yield* auditOf(plan.id)).map((e) => e.event);
        assert.deepStrictEqual(events.slice(-4), [
          'REVIEW_RECORDED',
          'REVIEW_RECORDED',
          'REVIEW_RECORDED',
          'REVIEW_CONFIRMED',
        ]);

        // A plan waiting for agreement has no closing review yet.
        yield* signInAs('Daniel Okafor');
        const daniel = (yield* api.development.mine()).plan;
        assert.strictEqual(daniel?.status, 'proposed');
        assert.isFalse(daniel?.canRecordReview);
        assert.strictEqual(
          (yield* api.development
            .recordPlanReview({
              params: { id: daniel?.id as PlanId },
              payload: {
                version: daniel?.version ?? -1,
                outcomes: (daniel?.focusSkills ?? []).map((f) => ({
                  skillId: f.skill.id,
                  outcome: 'partly' as const,
                })),
                summary: 'Too early to say.',
              },
            })
            .pipe(Effect.flip))._tag,
          'Unprocessable',
        );
      }),
  );

  it.effect(
    'unfinished plans past their period expire, drafts included; a recorded review neither exempts nor is lost',
    () =>
      Effect.gen(function* () {
        const { api, ids, skill, day, planRow, versionOf, auditOf, reviewOf } = yield* setup;
        const period = { periodStart: day(-200), periodEnd: day(-30) };
        // Grace's plan was revised late and stayed a draft past its period.
        yield* signInAs('Grace Liu');
        const stale = yield* api.development.createPlan({
          payload: {
            title: 'Service model, second try',
            intent: '',
            ...period,
            focusSkills: [{ skillId: skill('relationship-deepening'), targetLevel: 2 }],
          },
        });
        // Marcus's agreed plan ran out with his closing review recorded but not confirmed.
        yield* signInAs('Marcus Hill');
        const marcus = yield* api.development.createPlan({
          payload: {
            title: 'Calm volatility calls',
            intent: '',
            ...period,
            focusSkills: [{ skillId: skill('behavioral-coaching'), targetLevel: 2 }],
          },
        });
        yield* api.development.addActivity({
          params: { id: marcus.id },
          payload: {
            templateId: null,
            title: 'Calls after market drops',
            description: '',
            skills: [{ skillId: skill('behavioral-coaching'), role: 'primary' }],
            dueOn: null,
            intendedObserverId: null,
            intendedMode: null,
          },
        });
        yield* api.development.planEvent({
          params: { id: marcus.id },
          payload: { event: 'PROPOSE', version: yield* versionOf(marcus.id) },
        });
        yield* signInAs('Priya Raman');
        yield* api.development.planEvent({
          params: { id: marcus.id },
          payload: { event: 'AGREE', version: yield* versionOf(marcus.id) },
        });
        yield* signInAs('Marcus Hill');
        yield* api.development.recordPlanReview(yield* reviewOf(marcus.id, 'partly'));

        assert.isAbove(yield* runSweeps(), 1);
        assert.strictEqual((yield* planRow(stale.id))?.status, 'expired');
        const expired = yield* planRow(marcus.id);
        assert.strictEqual(expired?.status, 'expired');
        assert.strictEqual(expired?.reviewRecordedById, ids.marcus);
        for (const id of [stale.id, marcus.id]) {
          const last = (yield* auditOf(id)).at(-1);
          assert.deepStrictEqual(
            [last?.event, last?.actorId, last?.reasonCode, last?.toState],
            ['EXPIRE', null, 'expired', 'expired'],
          );
        }
        // Maya's plan, still within its period, is untouched.
        yield* signInAs('Maya Chen');
        assert.strictEqual((yield* api.development.mine()).plan?.status, 'active');

        // The expired draft no longer blocks Grace's next plan.
        yield* signInAs('Grace Liu');
        const next = yield* api.development.createPlan({
          payload: {
            title: 'Service model, this quarter',
            intent: '',
            periodStart: day(0),
            periodEnd: day(90),
            focusSkills: [{ skillId: skill('relationship-deepening'), targetLevel: 2 }],
          },
        });
        assert.strictEqual(next.status, 'draft');

        // Priya (his leader, he has no coach) confirms the review on the expired plan.
        yield* signInAs('Priya Raman');
        const past = (yield* api.development.of({ params: { id: ids.marcus } })).pastPlans;
        const closed = past.find((p) => p.id === marcus.id);
        assert.isTrue(closed?.canConfirmReview);
        assert.deepStrictEqual(
          closed?.focusSkills.map((f) => f.outcome),
          ['partly'],
        );
        const confirmed = yield* api.development.confirmPlanReview({
          params: { id: marcus.id },
          payload: { version: closed?.version ?? -1 },
        });
        assert.strictEqual(confirmed.review?.confirmedBy?.id, ids.priya);
      }),
  );

  it.effect('a person in another tenant cannot touch a plan or its review', () =>
    Effect.gen(function* () {
      const { api, mayaPlan, reviewOf } = yield* setup;
      const plan = yield* mayaPlan();
      const review = yield* reviewOf(plan.id, 'achieved');
      yield* seedSecondTenant;
      yield* signInAs(OUTSIDER);
      const answers = yield* Effect.all(
        [
          api.development.updatePlan({
            params: { id: plan.id },
            payload: { version: plan.version, title: 'Taken over' },
          }),
          api.development.planEvent({
            params: { id: plan.id },
            payload: { event: 'REVISE', version: plan.version },
          }),
          api.development.recordPlanReview(review),
          api.development.confirmPlanReview({
            params: { id: plan.id },
            payload: { version: plan.version },
          }),
        ].map((call) =>
          call.pipe(
            Effect.flip,
            Effect.map((e) => e._tag),
          ),
        ),
      );
      assert.deepStrictEqual(answers, ['NotFound', 'NotFound', 'NotFound', 'NotFound']);
    }),
  );
});
