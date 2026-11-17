import { Api, type ObservationDraftInput, type ObservationView } from '@repo/api';
import {
  DEFAULT_CREDIT_POLICY,
  PositionId,
  creditPolicyVersion,
  type ActivityId,
  type InteractionId,
  type IsoDate,
  type Level,
  type ObservationId,
  type PersonId,
  type SkillId,
  type SkillRole,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { addDaysIso, today } from '../platform/time.ts';
import { saveCreditPolicy } from '../features/shared/recognition.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: weighted, signed credit (design 2026-11-17 rev. 2, §2, §4, §5).
 * Protects I2 (a credit copies its signed rating, role included, with its
 * points resolved once and frozen), the value precedence (activity's own value,
 * the template value copied onto the activity, the skill's, the tenant's), the
 * observer owning roles, one piece of work counting once however many observers
 * sign it, a badge earned from secondary credit alone, and a void judged by the
 * award's saved thresholds, then re-awarded under the current policy.
 */
const client = HttpApiTest.groups(Api, ['observations', 'development']);

/** A complete policy to save, as a program owner's form would send it. */
const policy = (overrides: Partial<typeof DEFAULT_CREDIT_POLICY>) => {
  const { version: _, ...rest } = { ...DEFAULT_CREDIT_POLICY, ...overrides };
  return rest;
};

const NARRATIVE =
  'She asked what had changed since last year and let the couple set the agenda before any numbers.';

layer(ScenarioLayer, { timeout: 120_000 })('weighted credit', (it) => {
  const setup = Effect.gen(function* () {
    yield* atScenarioTime;
    yield* seedWorld;
    const db = yield* Db;
    const api = yield* client;
    const ids = {
      maya: yield* signInAs('Maya Chen'),
      sam: yield* signInAs('Sam Rivera'),
      leo: yield* signInAs('Leo Okonkwo'),
    };
    const [maya] = yield* db.select().from(schema.person).where(eq(schema.person.id, ids.maya));
    const tenantId = maya?.tenantId;
    if (!tenantId) return yield* Effect.die('seeded Maya missing');
    const skills = yield* db.select().from(schema.skill).where(eq(schema.skill.tenantId, tenantId));
    const skill = (slug: string) => skills.find((s) => s.slug === slug)?.id as SkillId;
    yield* signInAs('Maya Chen');
    const plan = (yield* api.development.mine()).plan;
    const activity = (title: string) =>
      plan?.activities.find((a) => a.title.startsWith(title))?.id as ActivityId;
    const on = yield* today;
    const day = (offset: number) => addDaysIso(on, offset);

    /** As Maya: log work on an activity and ask an observer to look at it. */
    const ask = (
      activityId: ActivityId,
      occurredOn: IsoDate,
      observers: ReadonlyArray<PersonId>,
      skillIds: ReadonlyArray<SkillId>,
      interactionId?: InteractionId,
    ) =>
      Effect.gen(function* () {
        yield* signInAs('Maya Chen');
        const work =
          interactionId ??
          (yield* api.development.logInteraction({
            payload: {
              activityId,
              adHocTitle: null,
              adHocSkillIds: [],
              occurredOn,
              kind: 'client_meeting',
              clientRef: null,
              reflection: 'Led the review and asked what had changed for the household this year.',
            },
          })).id;
        const views: Array<ObservationView> = [];
        for (const observerId of observers) {
          views.push(
            yield* api.observations.request({
              payload: { interactionId: work, observerId, mode: 'saw_it', skillIds, note: null },
            }),
          );
        }
        return { interactionId: work, views };
      });

    /** As the observer: sign with a level per skill and, optionally, a chosen role. */
    const sign = (
      observer: string,
      view: ObservationView,
      ratings: ReadonlyArray<{ skillId: SkillId; level: Level; role?: SkillRole }>,
    ) =>
      Effect.gen(function* () {
        yield* signInAs(observer);
        return yield* api.observations.sign({
          params: { id: view.id },
          payload: {
            version: view.version,
            mode: 'saw_it',
            ratings: ratings.map((r) => ({
              skillId: r.skillId,
              level: r.level,
              indicatorIds: [],
              credit: true,
              ...(r.role && { role: r.role }),
            })),
            narrativeSaw: NARRATIVE,
            narrativeNext: 'Summarize their priorities back before showing the plan.',
          },
        });
      });

    return { db, api, ids, tenantId, skill, activity, day, ask, sign };
  });

  it.effect(
    'I2: signing freezes each credit’s role, points, source and the subject’s position',
    () =>
      Effect.gen(function* () {
        const { db, api, ids, tenantId, skill, activity, day, ask, sign } = yield* setup;
        const discovery = activity('Discovery meetings');
        const [clientDiscovery, explaining, planning] = [
          skill('client-discovery'),
          skill('explaining-simply'),
          skill('goals-based-planning'),
        ];
        // Catalog and activity values, written as their (later) admin use cases would.
        yield* db
          .update(schema.activitySkill)
          .set({ templatePoints: 8 })
          .where(
            and(
              eq(schema.activitySkill.activityId, discovery),
              eq(schema.activitySkill.skillId, clientDiscovery),
            ),
          );
        yield* db
          .update(schema.skill)
          .set({ secondaryPoints: 4 })
          .where(eq(schema.skill.id, explaining));
        const positionId = PositionId.generate();
        yield* db.insert(schema.personPosition).values({
          id: positionId,
          tenantId,
          personId: ids.maya,
          title: 'Financial Advisor',
          validFrom: day(-400),
          source: 'seed',
        });

        // The tenant's limit on skills per observation is enforced by the server.
        yield* signInAs('Maya Chen');
        const tooMany = yield* ask(
          discovery,
          day(-3),
          [ids.sam],
          [clientDiscovery, explaining, planning, skill('transparency')],
        ).pipe(Effect.flip);
        assert.strictEqual(tooMany._tag, 'Unprocessable');

        const first = yield* ask(
          discovery,
          day(-3),
          [ids.sam],
          [clientDiscovery, explaining, planning],
        );
        const firstView = first.views[0] as ObservationView;
        // Default roles come from the activity; a skill it does not list is secondary.
        assert.deepStrictEqual(
          firstView.ratings.map((r) => r.role),
          ['primary', 'secondary', 'secondary'],
        );
        const signed = yield* sign('Sam Rivera', firstView, [
          { skillId: clientDiscovery, level: 3 },
          { skillId: explaining, level: 2 },
          { skillId: planning, level: 2 },
        ]);
        assert.deepStrictEqual(
          signed.credits.map((c) => [c.skill.slug, c.role, c.points, c.pointsSource]),
          [
            ['client-discovery', 'primary', 8, 'template'],
            ['explaining-simply', 'secondary', 4, 'skill'],
            ['goals-based-planning', 'secondary', 3, 'tenant'],
          ],
        );
        const firstCredits = yield* db
          .select()
          .from(schema.creditEntry)
          .where(eq(schema.creditEntry.observationId, firstView.id));
        assert.isTrue(firstCredits.every((c) => c.subjectPositionId === positionId));
        assert.isTrue(
          firstCredits.every((c) => c.policyVersion === creditPolicyVersion(DEFAULT_CREDIT_POLICY)),
        );

        // The activity's own value wins over every other value, whatever the role.
        yield* db
          .update(schema.activitySkill)
          .set({ pointsOverride: 15, pointsOverrideById: ids.sam })
          .where(
            and(
              eq(schema.activitySkill.activityId, discovery),
              eq(schema.activitySkill.skillId, clientDiscovery),
            ),
          );
        const second = yield* ask(discovery, day(-2), [ids.leo], [clientDiscovery, explaining]);
        const secondView = second.views[0] as ObservationView;

        // The observer owns the roles: two primaries are refused; the subject cannot write them.
        yield* signInAs('Leo Okonkwo');
        const draft = (
          roles: ReadonlyArray<SkillRole>,
        ): { params: { id: ObservationId }; payload: ObservationDraftInput } => ({
          params: { id: secondView.id },
          payload: {
            version: secondView.version,
            mode: 'saw_it',
            ratings: [clientDiscovery, explaining].map((skillId, i) => ({
              skillId,
              level: 3 as const,
              indicatorIds: [],
              credit: true,
              role: roles[i] as SkillRole,
            })),
            narrativeSaw: NARRATIVE,
            narrativeNext: '',
          },
        });
        const twoPrimaries = yield* api.observations
          .saveDraft(draft(['primary', 'primary']))
          .pipe(Effect.flip);
        assert.strictEqual(twoPrimaries._tag, 'Unprocessable');
        const saved = yield* api.observations.saveDraft(draft(['secondary', 'primary']));
        assert.deepStrictEqual(
          saved.ratings.map((r) => [r.role, r.roleChoosable]),
          [
            ['secondary', true],
            ['primary', true],
          ],
        );
        yield* signInAs('Maya Chen');
        const asSubject = yield* api.observations
          .saveDraft(draft(['primary', 'secondary']))
          .pipe(Effect.flip);
        assert.strictEqual(asSubject._tag, 'Forbidden');

        // Signed without roles: the stored roles stand.
        const secondSigned = yield* sign('Leo Okonkwo', saved, [
          { skillId: clientDiscovery, level: 3 },
          { skillId: explaining, level: 3 },
        ]);
        assert.deepStrictEqual(
          secondSigned.credits.map((c) => [c.skill.slug, c.role, c.points, c.pointsSource]),
          [
            ['client-discovery', 'secondary', 15, 'activity'],
            ['explaining-simply', 'primary', 10, 'tenant'],
          ],
        );
        assert.isTrue(secondSigned.ratings.every((r) => !r.roleChoosable));
        const [audit] = yield* db
          .select()
          .from(schema.auditEvent)
          .where(
            and(eq(schema.auditEvent.entityId, secondView.id), eq(schema.auditEvent.event, 'SIGN')),
          );
        assert.deepStrictEqual((audit?.data as { roles?: unknown } | undefined)?.roles, {
          [clientDiscovery]: 'secondary',
          [explaining]: 'primary',
        });

        // Frozen: the earlier credit keeps the value it was signed with.
        const again = yield* db
          .select()
          .from(schema.creditEntry)
          .where(eq(schema.creditEntry.observationId, firstView.id))
          .orderBy(asc(schema.creditEntry.points));
        assert.deepStrictEqual(
          again.map((c) => c.points),
          [3, 4, 8],
        );
      }),
  );

  it.effect(
    'a badge earned from secondary credit alone; one piece of work counts once; a void is judged by the award’s thresholds',
    () =>
      Effect.gen(function* () {
        const { db, api, ids, tenantId, skill, activity, day, ask, sign } = yield* setup;
        const review = activity('Lead the goals conversation');
        const deepening = skill('relationship-deepening');
        // The program owner makes secondary work worth as much as primary work.
        yield* saveCreditPolicy(tenantId, 1, policy({ secondaryPoints: 10 }));
        const stale = yield* saveCreditPolicy(tenantId, 1, policy({ secondaryPoints: 5 })).pipe(
          Effect.flip,
        );
        assert.strictEqual(stale._tag, 'Conflict');

        const asSecondary = [{ skillId: deepening, level: 2 as const, role: 'secondary' as const }];
        const a = yield* ask(review, day(-29), [ids.sam, ids.leo], [deepening]);
        const [aSam, aLeo] = a.views as [ObservationView, ObservationView];
        yield* sign('Sam Rivera', aSam, asSecondary);
        yield* sign('Leo Okonkwo', aLeo, asSecondary);
        const b = yield* ask(review, day(-15), [ids.sam], [deepening]);
        const bSam = b.views[0] as ObservationView;
        yield* sign('Sam Rivera', bSam, asSecondary);

        yield* signInAs('Maya Chen');
        const progress = (yield* api.development.mine()).otherProgress.find(
          (p) => p.skill.slug === 'relationship-deepening',
        );
        // Two observers signed the first piece of work: it still counts once.
        assert.deepInclude(progress, {
          points: 20,
          pointsRequired: 30,
          demonstrations: 2,
          pointsPerObservation: { primary: 10, secondary: 10 },
        });

        const c = yield* ask(review, day(-1), [ids.leo], [deepening]);
        const cLeo = c.views[0] as ObservationView;
        const completed = yield* sign('Leo Okonkwo', cLeo, asSecondary);
        assert.deepStrictEqual(
          completed.badgesEarned.map((x) => [x.skill.slug, x.level]),
          [['relationship-deepening', 2]],
        );
        const credits = yield* db
          .select()
          .from(schema.creditEntry)
          .where(
            and(
              eq(schema.creditEntry.personId, ids.maya),
              eq(schema.creditEntry.skillId, deepening),
            ),
          );
        assert.isTrue(credits.every((x) => x.role === 'secondary' && x.points === 10));
        const awardOf = () =>
          db
            .select()
            .from(schema.badgeAward)
            .where(
              and(
                eq(schema.badgeAward.personId, ids.maya),
                eq(schema.badgeAward.skillId, deepening),
              ),
            )
            .orderBy(asc(schema.badgeAward.awardedAt), asc(schema.badgeAward.status));
        const [award] = yield* awardOf();
        assert.deepInclude(award?.criteria.thresholds, { badgePoints: 30, minInteractions: 3 });

        // The policy tightens after the award. Voiding Leo's duplicate leaves the
        // award's own thresholds met (Sam's credit still counts that work): it stays.
        yield* saveCreditPolicy(tenantId, 2, policy({ secondaryPoints: 10, badgePoints: 40 }));
        yield* signInAs('Nina Patel');
        yield* api.observations.transition({
          params: { id: aLeo.id },
          payload: { event: 'VOID', note: 'Leo was not in that meeting after all.' },
        });
        assert.deepStrictEqual(
          (yield* awardOf()).map((x) => x.status),
          ['awarded'],
        );

        // The policy loosens. Voiding Sam's second observation fails the saved
        // thresholds (30 points): revoked. The current policy (20 points, two
        // pieces of work) is still met: awarded again, with today's thresholds.
        yield* saveCreditPolicy(
          tenantId,
          3,
          policy({ secondaryPoints: 10, badgePoints: 20, minInteractions: 2 }),
        );
        yield* api.observations.transition({
          params: { id: bSam.id },
          payload: { event: 'VOID', note: 'Recorded against the wrong household.' },
        });
        const after = yield* awardOf();
        assert.deepStrictEqual(after.map((x) => x.status).toSorted(), ['awarded', 'revoked']);
        const reawarded = after.find((x) => x.status === 'awarded');
        assert.notStrictEqual(reawarded?.id, award?.id);
        assert.deepInclude(reawarded?.criteria.thresholds, { badgePoints: 20, minInteractions: 2 });
        assert.strictEqual(reawarded?.triggeringObservationId, cLeo.id);
        const events = yield* db
          .select({ event: schema.auditEvent.event })
          .from(schema.auditEvent)
          .where(
            inArray(
              schema.auditEvent.entityId,
              after.map((x) => x.id),
            ),
          );
        assert.deepStrictEqual(events.map((e) => e.event).toSorted(), ['AWARD', 'AWARD', 'REVOKE']);
      }),
  );
});
