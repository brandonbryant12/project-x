import { Api, type ObservationView } from '@repo/api';
import {
  DEFAULT_CREDIT_POLICY,
  type ActivityId,
  type InteractionId,
  type IsoDate,
  type PersonId,
  type SkillId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpApiTest } from 'effect/http-api';
import { addDaysIso, today } from '../platform/time.ts';
import { saveCreditPolicy } from '../features/shared/recognition.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { SCENARIO_NOW, ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: one piece of work, seen by two observers, earns a badge once
 * (design 2026-11-17 rev. 3, §5, §9). "I saw this" offers the work the coachee
 * already logged and attaches to it instead of recording it again; it refuses
 * work that is not the subject's, already observed by this observer, or outside
 * the observe window. "How this was earned" groups credits by piece of work
 * through the one projection (the work counts once, the counted credit is
 * marked), sets the total against the thresholds saved on the award, labels an
 * individual activity value, marks credit reversed since the award and leaves
 * it out, shows the observer's words only to those who may read them (I13), and
 * shows points and per-credit detail only to the holder's development viewers
 * (I48). The pure assembly, including credit from before roles, is tested in
 * `features/people/receipt.test.ts`.
 */
const client = HttpApiTest.groups(Api, ['observations', 'development', 'people']);

const NARRATIVE =
  'She asked what had changed for the household this year before opening the plan, and let them set the order.';
const REASON = 'Agreed in coaching: the goals conversation is the focus this quarter.';

layer(ScenarioLayer, { timeout: 120_000 })('same work once; how this was earned', (it) => {
  it.effect(
    'I46/I13: two observers of one piece of work count it once; the receipt shows why, by the award’s thresholds',
    () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        yield* seedWorld;
        const db = yield* Db;
        const api = yield* client;
        const ids = {
          maya: yield* signInAs('Maya Chen'),
          sam: yield* signInAs('Sam Rivera'),
          leo: yield* signInAs('Leo Okonkwo'),
          daniel: yield* signInAs('Daniel Okafor'),
        };
        const on = yield* today;
        const day = (offset: number) => addDaysIso(on, offset);
        const [planning] = yield* db
          .select({ id: schema.skill.id, tenantId: schema.skill.tenantId })
          .from(schema.skill)
          .where(eq(schema.skill.slug, 'goals-based-planning'));
        if (!planning) return yield* Effect.die('seeded skill missing');
        const skillId = planning.id as SkillId;

        // Sam, Maya's coach, valued her goals conversations a month ago, before any
        // was done or logged (a value applies only to work logged after it is set).
        yield* TestClock.setTime(SCENARIO_NOW - 30 * 86_400_000);
        yield* signInAs('Sam Rivera');
        const annual = (yield* api.development.of({
          params: { id: ids.maya },
        })).plan?.activities.find((a) => a.title.startsWith('Lead the goals conversation'));
        assert.isDefined(annual);
        yield* api.development.setActivityValue({
          params: { id: annual.id },
          payload: { version: annual.version, skillId, points: 12, reason: REASON },
        });
        yield* atScenarioTime;

        /** As Maya: log the work and ask these observers to look at it. */
        const logAndAsk = (occurredOn: IsoDate, observers: ReadonlyArray<PersonId>) =>
          Effect.gen(function* () {
            yield* signInAs('Maya Chen');
            const work = yield* api.development.logInteraction({
              payload: {
                activityId: annual.id as ActivityId,
                adHocTitle: null,
                adHocSkillIds: [],
                occurredOn,
                kind: 'client_meeting',
                clientRef: null,
                reflection: 'Led the annual review and asked what had changed for them.',
              },
            });
            const views: Array<ObservationView> = [];
            for (const observerId of observers) {
              views.push(
                yield* api.observations.request({
                  payload: {
                    interactionId: work.id,
                    observerId,
                    mode: 'saw_it',
                    skillIds: [skillId],
                    note: null,
                  },
                }),
              );
            }
            return { id: work.id, views };
          });
        const sign = (observer: string, view: ObservationView) =>
          Effect.gen(function* () {
            yield* signInAs(observer);
            return yield* api.observations.sign({
              params: { id: view.id },
              payload: {
                version: view.version,
                mode: 'saw_it',
                ratings: [{ skillId, level: 2, indicatorIds: [], credit: true }],
                narrativeSaw: NARRATIVE,
                narrativeNext: 'Write their three priorities down in their words.',
              },
            });
          });

        // The first meeting: both observers were there.
        const first = yield* logAndAsk(day(-29), [ids.sam, ids.leo]);
        const [firstSam, firstLeo] = first.views as [ObservationView, ObservationView];
        yield* sign('Sam Rivera', firstSam);
        yield* sign('Leo Okonkwo', firstLeo);
        const second = yield* logAndAsk(day(-15), [ids.sam]);
        yield* sign('Sam Rivera', second.views[0] as ObservationView);
        // The third: Maya logs it, asks nobody; Leo was there.
        const third = yield* logAndAsk(day(-1), []);

        // "I saw this" offers the work Maya logged in the window that Leo has not observed.
        yield* signInAs('Leo Okonkwo');
        const targets = yield* api.observations.targets();
        assert.strictEqual(targets.maxSkills, DEFAULT_CREDIT_POLICY.maxSkillsPerObservation);
        const maya = targets.people.find((t) => t.person.id === ids.maya);
        assert.isDefined(maya);
        const offered = maya.work.map((w) => w.id);
        assert.include(offered, third.id);
        assert.notInclude(offered, second.id); // outside the window
        // Title and kind of the work, and its skills with their default roles; no reflection.
        const thirdOffer = maya.work.find((w) => w.id === third.id);
        assert.deepInclude(thirdOffer?.skills[0], { role: 'primary' });
        assert.strictEqual(thirdOffer?.skills[0]?.skill.id, skillId);
        assert.notProperty(thirdOffer, 'reflection');
        const pending = (yield* api.observations.inbox()).requests.find(
          (r) => r.subject.id === ids.maya,
        );
        assert.isDefined(pending);
        const pendingView = yield* api.observations.get({ params: { id: pending.id } });
        // Work Leo was already asked about is not offered again.
        assert.notInclude(offered, pendingView.interaction.id);

        const attach = (interactionId: InteractionId, subjectId: PersonId = ids.maya) =>
          api.observations.start({
            payload: {
              subjectId,
              interactionId,
              activityId: null,
              title: null,
              occurredOn: day(0),
              kind: 'presentation',
              mode: 'saw_it',
              skillIds: [skillId],
            },
          });
        const [danielWork] = yield* db
          .select({ id: schema.interaction.id })
          .from(schema.interaction)
          .where(eq(schema.interaction.ownerId, ids.daniel));
        assert.isDefined(danielWork);
        assert.strictEqual((yield* attach(danielWork.id).pipe(Effect.flip))._tag, 'NotFound');
        assert.strictEqual(
          (yield* attach(pendingView.interaction.id).pipe(Effect.flip))._tag,
          'Conflict',
        );
        // Sam's 15-day-old meeting is outside the observe window.
        assert.strictEqual((yield* attach(second.id).pipe(Effect.flip))._tag, 'Unprocessable');

        const interactionsOfMaya = () =>
          db
            .select({ id: schema.interaction.id })
            .from(schema.interaction)
            .where(eq(schema.interaction.ownerId, ids.maya));
        const count = (yield* interactionsOfMaya()).length;
        const attached = yield* attach(third.id);
        // The same work, at its own date and kind; nothing new was logged.
        assert.strictEqual(attached.interaction.id, third.id);
        assert.deepStrictEqual(
          [attached.interaction.occurredOn, attached.interaction.kind],
          [day(-1), 'client_meeting'],
        );
        assert.lengthOf(yield* interactionsOfMaya(), count);
        // The observer's draft shows the skill limit and what signing would add.
        assert.strictEqual(attached.maxSkills, DEFAULT_CREDIT_POLICY.maxSkillsPerObservation);
        assert.deepStrictEqual(attached.ratings[0]?.values, { primary: 12, secondary: 12 });
        assert.strictEqual((yield* attach(third.id).pipe(Effect.flip))._tag, 'Conflict');
        const completed = yield* sign('Leo Okonkwo', attached);
        assert.deepStrictEqual(
          completed.badgesEarned.map((b) => [b.skill.slug, b.level]),
          [['goals-based-planning', 2]],
        );

        // The program owner raises the bar afterwards; the receipt keeps the award's own.
        const { version, ...stored } = DEFAULT_CREDIT_POLICY;
        yield* saveCreditPolicy(planning.tenantId, version, { ...stored, badgePoints: 40 });
        const [award] = yield* db
          .select()
          .from(schema.badgeAward)
          .where(
            and(eq(schema.badgeAward.personId, ids.maya), eq(schema.badgeAward.skillId, skillId)),
          );
        assert.isDefined(award);
        yield* signInAs('Sam Rivera');
        const receipt = yield* api.people.badgeReceipt({
          params: { id: ids.maya, badgeId: award.id },
        });
        assert.deepInclude(receipt.required, { points: 30, interactions: 3, observers: 2 });
        assert.strictEqual(receipt.points, 36);
        assert.deepStrictEqual(
          receipt.work.map((w) => [w.occurredOn, w.points, w.credits.length]),
          [
            [day(-29), 12, 2],
            [day(-15), 12, 1],
            [day(-1), 12, 1],
          ],
        );
        // Two observers, one piece of work: exactly one credit counted; the value is the activity's.
        assert.deepStrictEqual(receipt.work[0]?.credits.map((c) => c.counted).toSorted(), [
          false,
          true,
        ]);
        assert.isTrue(
          receipt.work
            .flatMap((w) => w.credits)
            .every((c) => c.pointsSource === 'activity' && c.role === 'primary' && c.points === 12),
        );
        // Sam, her coach, reads every observer's words.
        assert.isTrue(receipt.work.flatMap((w) => w.credits).every((c) => c.narrativeSaw !== null));

        // Rhea, two levels up, sees the record but never the words.
        yield* signInAs('Rhea Castillo');
        const fromAbove = yield* api.people.badgeReceipt({
          params: { id: ids.maya, badgeId: award.id },
        });
        assert.isFalse(fromAbove.narrativesVisible);
        assert.isTrue(
          fromAbove.work.flatMap((w) => w.credits).every((c) => c.narrativeSaw === null),
        );

        // A colleague with no part in Maya's development sees the badge and the plain
        // facts, never points, thresholds or who credited what (I48).
        yield* signInAs('Daniel Okafor');
        const asColleague = yield* api.people.badgeReceipt({
          params: { id: ids.maya, badgeId: award.id },
        });
        assert.deepInclude(asColleague, {
          detailVisible: false,
          narrativesVisible: false,
          points: null,
          required: null,
          work: [],
        });
        assert.notMatch(asColleague.facts, /points/);

        // Compliance voids Leo's observation of the first meeting. The badge still
        // stands on the award's thresholds; the receipt marks the reversed credit and
        // counts the work at Sam's credit.
        yield* signInAs('Nina Patel');
        yield* api.observations.transition({
          params: { id: firstLeo.id },
          payload: { event: 'VOID', note: 'Recorded against the wrong meeting.' },
        });
        yield* signInAs('Sam Rivera');
        const afterVoid = yield* api.people.badgeReceipt({
          params: { id: ids.maya, badgeId: award.id },
        });
        assert.strictEqual(afterVoid.points, 36);
        const firstMeeting = afterVoid.work[0]?.credits ?? [];
        assert.deepInclude(
          firstMeeting.find((c) => c.observer.id === ids.sam),
          { counted: true, reversed: false },
        );
        assert.deepInclude(
          firstMeeting.find((c) => c.observer.id === ids.leo),
          { counted: false, reversed: true },
        );
      }),
  );
});
