import { Api, type ActivityView, type PlanView } from '@repo/api';
import {
  DEFAULT_CREDIT_POLICY,
  RoleGrantId,
  type ActivityId,
  type IsoDate,
  type SkillId,
  type SkillRole,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { inspectTenantCreditPolicy, saveCreditPolicy } from '../features/shared/recognition.ts';
import { addDaysIso, today } from '../platform/time.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';
import { OUTSIDER, seedSecondTenant } from '../test/second-tenant.ts';

/**
 * Journey: planning work with roles and values (design 2026-11-17 §4, §6, §8).
 * Protects: only the owner and a plan agreer add or change work; at most one
 * primary skill, published skills only; work starts only from a published
 * template, whose values are copied for its own skills in their own roles and
 * never re-read; editing work diffs its skills, so an individual value survives
 * other edits and leaves only with its skill; an individual value is set by an
 * agreer or a program owner, never the subject whatever grants they hold,
 * within the tenant's range, with a reason, before the work is observed, and a
 * credit signed afterwards carries it while earlier credit is unchanged. The
 * tests share one seeded tenant and run in order.
 */
const client = HttpApiTest.groups(Api, ['development', 'observations']);

const REASON = 'Complex household; the review takes a full afternoon of preparation.';

const work = (plan: PlanView, title: string): ActivityView => {
  const found = plan.activities.find((a) => a.title.startsWith(title));
  if (!found) throw new Error(`no work titled ${title}`);
  return found;
};

/** The tag of the error an effect fails with. */
const failure = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((e) => e._tag),
  );

layer(ScenarioLayer, { timeout: 120_000 })('work roles and values', (it) => {
  const setup = Effect.gen(function* () {
    yield* atScenarioTime;
    yield* seedWorld;
    const db = yield* Db;
    const api = yield* client;
    const ids = {
      maya: yield* signInAs('Maya Chen'),
      sam: yield* signInAs('Sam Rivera'),
      elena: yield* signInAs('Elena Brooks'),
    };
    const [maya] = yield* db.select().from(schema.person).where(eq(schema.person.id, ids.maya));
    const tenantId = maya?.tenantId;
    if (!tenantId) return yield* Effect.die('seeded Maya missing');
    const skills = yield* db.select().from(schema.skill).where(eq(schema.skill.tenantId, tenantId));
    const skill = (slug: string) => skills.find((s) => s.slug === slug)?.id as SkillId;
    const templates = yield* db
      .select()
      .from(schema.activityTemplate)
      .where(eq(schema.activityTemplate.tenantId, tenantId));
    const template = (slug: string) => {
      const found = templates.find((t) => t.slug === slug);
      if (!found) throw new Error(`no template ${slug}`);
      return found.id;
    };
    const on = yield* today;
    /** Maya's current plan, as the named person sees it. */
    const planAs = (name: string) =>
      Effect.gen(function* () {
        yield* signInAs(name);
        const view = yield* api.development.of({ params: { id: ids.maya } });
        if (!view.plan) return yield* Effect.die('Maya has no current plan');
        return view.plan;
      });
    const rowsOf = (activityId: ActivityId) =>
      db
        .select()
        .from(schema.activitySkill)
        .where(eq(schema.activitySkill.activityId, activityId))
        .orderBy(schema.activitySkill.position);
    const skillsOf = (activityId: ActivityId) =>
      rowsOf(activityId).pipe(
        Effect.map((rows) =>
          rows.map((r) => [
            skills.find((s) => s.id === r.skillId)?.slug,
            r.role,
            r.templatePoints,
            r.pointsOverride,
          ]),
        ),
      );
    const s = (slug: string, role: SkillRole) => ({ skillId: skill(slug), role });
    return {
      db,
      api,
      ids,
      tenantId,
      skill,
      template,
      on,
      planAs,
      rowsOf,
      skillsOf,
      s,
    };
  });

  it.effect(
    'work is added by the owner or an agreer, from a published template whose values are copied once',
    () =>
      Effect.gen(function* () {
        const { db, api, skill, template, on, planAs, skillsOf, s } = yield* setup;
        // The catalog, as its program owners would keep it.
        yield* db
          .update(schema.activityTemplateSkill)
          .set({ points: 12 })
          .where(
            and(
              eq(schema.activityTemplateSkill.templateId, template('annual-review')),
              eq(schema.activityTemplateSkill.skillId, skill('goals-based-planning')),
            ),
          );
        yield* db
          .update(schema.activityTemplateSkill)
          .set({ points: 5 })
          .where(
            and(
              eq(schema.activityTemplateSkill.templateId, template('annual-review')),
              eq(schema.activityTemplateSkill.skillId, skill('relationship-deepening')),
            ),
          );
        yield* db
          .update(schema.activityTemplate)
          .set({ status: 'draft' })
          .where(eq(schema.activityTemplate.id, template('book-review')));
        yield* db
          .update(schema.activityTemplate)
          .set({ status: 'retired' })
          .where(eq(schema.activityTemplate.id, template('joint-meeting')));
        yield* db
          .update(schema.skill)
          .set({ status: 'retired' })
          .where(eq(schema.skill.id, skill('book-stewardship')));

        const plan = yield* planAs('Sam Rivera');
        assert.isTrue(plan.canAddWork);
        const add = (
          payload: Partial<Parameters<typeof api.development.addActivity>[0]['payload']>,
        ) =>
          api.development.addActivity({
            params: { id: plan.id },
            payload: {
              templateId: template('annual-review'),
              title: 'Annual review with the Okafor household',
              description: 'Lead the goals conversation before any performance numbers.',
              skills: [
                s('goals-based-planning', 'primary'),
                s('relationship-deepening', 'secondary'),
              ],
              dueOn: addDaysIso(on, 30) as IsoDate,
              intendedObserverId: null,
              intendedMode: null,
              ...payload,
            },
          });

        // Neither her skip-level leader nor another branch's leader plans her work.
        for (const outsider of ['Rhea Castillo', 'Priya Raman']) {
          yield* signInAs(outsider);
          assert.strictEqual(yield* failure(add({})), 'Forbidden');
        }
        yield* signInAs('Sam Rivera');
        const refused = [
          yield* failure(
            add({
              skills: [s('goals-based-planning', 'primary'), s('client-discovery', 'primary')],
            }),
          ),
          yield* failure(add({ templateId: template('book-review') })),
          yield* failure(add({ templateId: template('joint-meeting') })),
          yield* failure(add({ skills: [s('book-stewardship', 'primary')] })),
        ];
        assert.deepStrictEqual(refused, [
          'Unprocessable',
          'Unprocessable',
          'Unprocessable',
          'Unprocessable',
        ]);

        // Planning is offered only published templates, with their roles and values.
        const offered = yield* api.development.workTemplates();
        assert.isFalse(
          offered.some((t) => [template('book-review'), template('joint-meeting')].includes(t.id)),
        );
        assert.deepStrictEqual(
          offered
            .find((t) => t.id === template('annual-review'))
            ?.skills.map((k) => [k.skill.slug, k.role, k.points]),
          [
            ['goals-based-planning', 'primary', 12],
            ['relationship-deepening', 'secondary', 5],
          ],
        );

        // The coach adds work from the template: a changed role drops the template's
        // value, a skill the template does not list gets none, its own skill keeps it.
        const added = yield* add({
          skills: [
            s('client-discovery', 'primary'),
            s('goals-based-planning', 'secondary'),
            s('relationship-deepening', 'secondary'),
          ],
        });
        const review = added.activities.find((a) => a.title.startsWith('Annual review with'));
        assert.isDefined(review);
        assert.deepStrictEqual(yield* skillsOf(review.id), [
          ['client-discovery', 'primary', null, null],
          ['goals-based-planning', 'secondary', null, null],
          ['relationship-deepening', 'secondary', 5, null],
        ]);

        // A template edited afterwards does not change the work already planned.
        yield* db
          .update(schema.activityTemplateSkill)
          .set({ points: 9 })
          .where(
            and(
              eq(schema.activityTemplateSkill.templateId, template('annual-review')),
              eq(schema.activityTemplateSkill.skillId, skill('relationship-deepening')),
            ),
          );
        const after = (yield* planAs('Maya Chen')).activities.find((a) => a.id === review.id);
        assert.deepStrictEqual(
          after?.skills.map((k) => [k.skill.slug, k.role, k.value.points, k.value.source]),
          [
            ['client-discovery', 'primary', DEFAULT_CREDIT_POLICY.primaryPoints, 'tenant'],
            ['goals-based-planning', 'secondary', DEFAULT_CREDIT_POLICY.secondaryPoints, 'tenant'],
            ['relationship-deepening', 'secondary', 5, 'template'],
          ],
        );
      }),
  );

  it.effect(
    'editing work diffs its skills: a value survives other edits and leaves only with its skill',
    () =>
      Effect.gen(function* () {
        const { db, api, planAs, skillsOf, s } = yield* setup;
        const review = work(yield* planAs('Sam Rivera'), 'Annual review with');
        assert.isTrue(review.canEdit);
        assert.isTrue(review.canSetValue);
        yield* api.development.setActivityValue({
          params: { id: review.id },
          payload: {
            skillId: s('relationship-deepening', 'secondary').skillId,
            points: 15,
            reason: REASON,
          },
        });
        const edit = (skills: ReadonlyArray<{ skillId: SkillId; role: SkillRole }>) =>
          api.development.updateActivity({
            params: { id: review.id },
            payload: {
              title: 'Annual review: the Okafor household',
              description: 'Goals first, numbers after.',
              skills,
              dueOn: review.dueOn,
              intendedObserverId: null,
              intendedMode: null,
            },
          });

        for (const outsider of ['Rhea Castillo', 'Priya Raman']) {
          yield* signInAs(outsider);
          assert.strictEqual(
            yield* failure(edit([s('relationship-deepening', 'primary')])),
            'Forbidden',
          );
        }
        // The owner edits the words and swaps the primary; the value stays.
        yield* signInAs('Maya Chen');
        yield* edit([
          s('goals-based-planning', 'primary'),
          s('client-discovery', 'secondary'),
          s('relationship-deepening', 'secondary'),
        ]);
        assert.deepStrictEqual(yield* skillsOf(review.id), [
          ['goals-based-planning', 'primary', null, null],
          ['client-discovery', 'secondary', null, null],
          ['relationship-deepening', 'secondary', 5, 15],
        ]);
        // Changing the role of the template's own skill drops the template's value, not the override.
        yield* edit([
          s('goals-based-planning', 'secondary'),
          s('relationship-deepening', 'primary'),
        ]);
        assert.deepStrictEqual(yield* skillsOf(review.id), [
          ['goals-based-planning', 'secondary', null, null],
          ['relationship-deepening', 'primary', null, 15],
        ]);
        assert.strictEqual(
          yield* failure(
            edit([s('goals-based-planning', 'primary'), s('relationship-deepening', 'primary')]),
          ),
          'Unprocessable',
        );
        // Removing the skill removes its value, and the audit says so.
        yield* edit([s('goals-based-planning', 'primary')]);
        assert.deepStrictEqual(yield* skillsOf(review.id), [
          ['goals-based-planning', 'primary', null, null],
        ]);
        const [edited] = yield* db
          .select()
          .from(schema.auditEvent)
          .where(
            and(eq(schema.auditEvent.entityId, review.id), eq(schema.auditEvent.event, 'EDIT')),
          )
          .orderBy(schema.auditEvent.seq)
          .pipe(Effect.map((rows) => rows.slice(-1)));
        assert.deepStrictEqual(edited?.data.removedValues, [
          { skillId: s('relationship-deepening', 'primary').skillId, points: 15 },
        ]);

        // Closed work is not edited.
        yield* api.development.activityEvent({
          params: { id: review.id },
          payload: { event: 'CANCEL' },
        });
        assert.strictEqual(
          yield* failure(edit([s('goals-based-planning', 'primary')])),
          'Unprocessable',
        );
      }),
  );

  it.effect(
    'an individual value: an agreer or program owner, never the subject, before the work is observed',
    () =>
      Effect.gen(function* () {
        const { db, api, ids, tenantId, skill, on, planAs } = yield* setup;
        // Maya and Elena run the program.
        yield* db.insert(schema.roleGrant).values(
          [ids.maya, ids.elena].map((personId) => ({
            id: RoleGrantId.generate(),
            tenantId,
            personId,
            role: 'program_owner' as const,
            validFrom: '2025-01-01' as IsoDate,
            source: 'seed',
          })),
        );
        const planning = skill('goals-based-planning');
        const annual = work(yield* planAs('Maya Chen'), 'Lead the goals conversation');
        const set = (points: number | null, reason = REASON, activityId = annual.id) =>
          api.development.setActivityValue({
            params: { id: activityId },
            payload: { skillId: planning, points, reason },
          });

        // The subject never values her own work, even as a program owner.
        assert.isFalse(annual.canSetValue);
        assert.strictEqual(yield* failure(set(14)), 'Forbidden');
        for (const outsider of ['Rhea Castillo', 'Priya Raman']) {
          yield* signInAs(outsider);
          assert.strictEqual(yield* failure(set(14)), 'Forbidden');
        }
        // A program owner and her coach may; the coach's value replaces Elena's.
        // A program owner sees nothing per person (ADR 0021): the answer carries no plan.
        yield* signInAs('Elena Brooks');
        assert.isNull(yield* set(12));
        yield* signInAs('Sam Rivera');
        yield* set(14);
        // Within the tenant's range, and with a reason.
        assert.deepStrictEqual(
          [
            yield* failure(set(21)),
            yield* failure(set(0)),
            yield* failure(set(16, ' '.repeat(12))),
          ],
          ['Unprocessable', 'Unprocessable', 'Unprocessable'],
        );
        const [row] = yield* db
          .select()
          .from(schema.activitySkill)
          .where(
            and(
              eq(schema.activitySkill.activityId, annual.id),
              eq(schema.activitySkill.skillId, planning),
            ),
          );
        assert.deepStrictEqual([row?.pointsOverride, row?.pointsOverrideById], [14, ids.sam]);
        const notes = yield* db
          .select()
          .from(schema.note)
          .where(and(eq(schema.note.entityId, annual.id), eq(schema.note.kind, 'value_override')));
        assert.lengthOf(notes, 2);
        const audits = yield* db
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.entityId, annual.id),
              eq(schema.auditEvent.event, 'SET_VALUE'),
            ),
          )
          .orderBy(schema.auditEvent.seq);
        assert.deepStrictEqual(audits.at(-1)?.data.before, { points: 12, setById: ids.elena });
        assert.deepStrictEqual(audits.at(-1)?.data.after, { points: 14, setById: ids.sam });

        // The coachee sees the value and who set it, with no control.
        const seen = work(yield* planAs('Maya Chen'), 'Lead the goals conversation').skills.find(
          (k) => k.skill.id === planning,
        );
        assert.deepStrictEqual(seen?.value, { points: 14, source: 'activity' });
        assert.strictEqual(seen?.override?.setBy.id, ids.sam);
        assert.deepStrictEqual(seen?.valueWithoutOverride, {
          points: DEFAULT_CREDIT_POLICY.primaryPoints,
          source: 'tenant',
        });

        // Switched off by the tenant: refused, and the screen offers nothing.
        const { version } = yield* inspectTenantCreditPolicy(tenantId);
        const { version: _, ...rest } = DEFAULT_CREDIT_POLICY;
        yield* saveCreditPolicy(tenantId, version, {
          ...rest,
          activityOverrides: { ...rest.activityOverrides, enabled: false },
        });
        const off = yield* planAs('Sam Rivera');
        assert.isNull(off.valueRange);
        assert.isFalse(work(off, 'Lead the goals conversation').canSetValue);
        assert.strictEqual(yield* failure(set(10)), 'Unprocessable');
        yield* saveCreditPolicy(tenantId, version + 1, rest);

        // Work already done is never valued: ad hoc work, and work with a signed observation.
        yield* signInAs('Maya Chen');
        const adHoc = yield* api.development.logInteraction({
          payload: {
            activityId: null,
            adHocTitle: 'Unplanned call about a pension transfer',
            adHocSkillIds: [planning],
            occurredOn: on,
            kind: 'client_meeting',
            clientRef: null,
            reflection: 'Walked through the trade-offs of transferring before setting any goal.',
          },
        });
        const discovery = work(yield* planAs('Sam Rivera'), 'Discovery meetings');
        assert.isFalse(discovery.canSetValue);
        assert.deepStrictEqual(
          [
            yield* failure(set(10, REASON, adHoc.activityId)),
            yield* failure(set(10, REASON, discovery.id)),
          ],
          ['Unprocessable', 'Unprocessable'],
        );

        // The credit signed afterwards carries the value; earlier credit is unchanged.
        const earlier = yield* db
          .select()
          .from(schema.creditEntry)
          .where(eq(schema.creditEntry.personId, ids.maya));
        yield* signInAs('Maya Chen');
        const logged = yield* api.development.logInteraction({
          payload: {
            activityId: annual.id,
            adHocTitle: null,
            adHocSkillIds: [],
            occurredOn: on,
            kind: 'client_meeting',
            clientRef: null,
            reflection: 'Opened the annual review by asking what had changed in their lives.',
          },
        });
        const request = yield* api.observations.request({
          payload: {
            interactionId: logged.id,
            observerId: ids.sam,
            mode: 'saw_it',
            skillIds: [planning],
            note: null,
          },
        });
        // Once it is open the value can no longer change.
        assert.isFalse(
          work(yield* planAs('Sam Rivera'), 'Lead the goals conversation').canSetValue,
        );
        assert.strictEqual(yield* failure(set(10)), 'Unprocessable');
        const signed = yield* api.observations.sign({
          params: { id: request.id },
          payload: {
            version: request.version,
            mode: 'saw_it',
            ratings: [{ skillId: planning, level: 2, indicatorIds: [], credit: true }],
            narrativeSaw:
              'Maya let the couple describe their year before she opened the plan, and wrote their words down.',
            narrativeNext: 'Read their goals back to them before the numbers.',
          },
        });
        assert.deepStrictEqual(
          signed.credits.map((c) => [c.role, c.points, c.pointsSource]),
          [['primary', 14, 'activity']],
        );
        const unchanged = yield* db
          .select()
          .from(schema.creditEntry)
          .where(eq(schema.creditEntry.personId, ids.maya));
        assert.deepStrictEqual(
          unchanged.filter((c) => earlier.some((e) => e.id === c.id)),
          earlier,
        );
      }),
  );

  it.effect('a person in another tenant cannot change work or its value', () =>
    Effect.gen(function* () {
      const { api, skill, planAs } = yield* setup;
      const plan = yield* planAs('Maya Chen');
      const annual = work(plan, 'Lead the goals conversation');
      yield* seedSecondTenant;
      yield* signInAs(OUTSIDER);
      const planning = skill('goals-based-planning');
      const answers = yield* Effect.all(
        [
          api.development.addActivity({
            params: { id: plan.id },
            payload: {
              templateId: null,
              title: 'Planted work',
              description: '',
              skills: [{ skillId: planning, role: 'primary' }],
              dueOn: null,
              intendedObserverId: null,
              intendedMode: null,
            },
          }),
          api.development.updateActivity({
            params: { id: annual.id },
            payload: {
              title: 'Taken over',
              description: '',
              skills: [{ skillId: planning, role: 'primary' }],
              dueOn: null,
              intendedObserverId: null,
              intendedMode: null,
            },
          }),
          api.development.setActivityValue({
            params: { id: annual.id },
            payload: { skillId: planning, points: 20, reason: REASON },
          }),
        ].map((call) =>
          call.pipe(
            Effect.flip,
            Effect.map((e) => e._tag),
          ),
        ),
      );
      assert.deepStrictEqual(answers, ['NotFound', 'NotFound', 'NotFound']);
    }),
  );
});
