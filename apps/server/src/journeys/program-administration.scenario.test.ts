import { Api, type LevelDraftInput, type ObservationView } from '@repo/api';
import {
  DEFAULT_CREDIT_POLICY,
  PersonId,
  RoleGrantId,
  creditPolicyVersion,
  type ActivityId,
  type IsoDate,
  type SkillId,
  type SkillVersionId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { addDaysIso, today } from '../platform/time.ts';
import { inspectTenantCreditPolicy, tenantCreditPolicy } from '../features/shared/recognition.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';
import { OUTSIDER, seedSecondTenant } from '../test/second-tenant.ts';

/**
 * Journey: a program owner runs the program's rules and catalog at run time
 * (design 2026-11-17 §2, §7). Protects: a credit-policy save needs a reason,
 * bumps the version under compare-and-set and is audited with before and
 * after; values below the working defaults are accepted while values no
 * criterion can mean are refused; a broken stored policy is reported, never
 * silently repaired, and a save repairs it; publishing a skill writes an
 * immutable version while observations keep the version they pinned;
 * retiring a skill stops new use but not history; a template lists each
 * skill once, at most one primary, published skills only; a credit signed
 * after a skill's value changes uses the new value and earlier credit keeps
 * its own; nothing crosses tenants. The tests share one seeded tenant and run
 * in order.
 */
const client = HttpApiTest.groups(Api, ['program', 'catalog', 'observations', 'development']);

const PROGRAM_OWNER = 'Pia Lund';
const REASON = 'Agreed with the practice leads at the November review.';

/** The working defaults without their version: a complete policy as the form sends it. */
const policy = (overrides: Partial<typeof DEFAULT_CREDIT_POLICY> = {}) => {
  const { version: _, ...rest } = { ...DEFAULT_CREDIT_POLICY, ...overrides };
  return rest;
};

const levels = (prefix: string): Array<LevelDraftInput> =>
  ([1, 2, 3, 4] as const).map((level) => ({
    level,
    summary: `${prefix} at level ${level}.`,
    indicators: [
      { lineageKey: null, text: `${prefix}: names the concern, level ${level}` },
      { lineageKey: null, text: `${prefix}: answers with evidence, level ${level}` },
    ],
  }));

/** A template's fields, as the editor sends them, with these skills. */
const templateInput = (
  skills: ReadonlyArray<[SkillId, 'primary' | 'secondary', number | null]>,
) => ({
  name: 'First meeting with a referred client',
  description: 'A first meeting with a client who came by referral.',
  kind: 'client_meeting' as const,
  observationTip: 'Notice who sets the agenda.',
  typicalMinutes: 45,
  skills: skills.map(([skillId, role, points]) => ({ skillId, role, points })),
});

const NARRATIVE =
  'She let the client name the worry first, then answered it with the plan’s own numbers.';

layer(ScenarioLayer, { timeout: 120_000 })('program administration', (it) => {
  const setup = Effect.gen(function* () {
    yield* atScenarioTime;
    yield* seedWorld;
    const db = yield* Db;
    const api = yield* client;
    const maya = yield* signInAs('Maya Chen');
    const sam = yield* signInAs('Sam Rivera');
    const [anchor] = yield* db.select().from(schema.person).where(eq(schema.person.id, maya));
    const tenantId = anchor?.tenantId;
    if (!tenantId) return yield* Effect.die('seeded Maya missing');
    // A program owner, as the directory import would add one.
    const [existing] = yield* db
      .select()
      .from(schema.person)
      .where(eq(schema.person.displayName, PROGRAM_OWNER));
    if (!existing) {
      const id = PersonId.generate();
      yield* db.insert(schema.person).values({
        id,
        tenantId,
        email: 'pia.lund@northwind.example',
        displayName: PROGRAM_OWNER,
      });
      yield* db.insert(schema.roleGrant).values({
        id: RoleGrantId.generate(),
        tenantId,
        personId: id,
        role: 'program_owner',
        validFrom: '2025-01-01' as IsoDate,
        source: 'seed',
      });
    }
    const skillIdOf = (slug: string) =>
      db
        .select({ id: schema.skill.id })
        .from(schema.skill)
        .where(and(eq(schema.skill.tenantId, tenantId), eq(schema.skill.slug, slug)))
        .pipe(Effect.map(([row]) => row?.id as SkillId));
    yield* signInAs('Maya Chen');
    const plan = (yield* api.development.mine()).plan;
    const discovery = plan?.activities.find((a) => a.title.startsWith('Discovery meetings'))
      ?.id as ActivityId;
    const on = yield* today;

    /** As Maya: log work on the discovery activity and ask Sam to observe these skills. */
    const ask = (daysAgo: number, skillIds: ReadonlyArray<SkillId>) =>
      Effect.gen(function* () {
        yield* signInAs('Maya Chen');
        const work = yield* api.development.logInteraction({
          payload: {
            activityId: discovery,
            adHocTitle: null,
            adHocSkillIds: [],
            occurredOn: addDaysIso(on, -daysAgo),
            kind: 'client_meeting',
            clientRef: null,
            reflection: 'Walked through the household’s worries before showing any numbers.',
          },
        });
        return yield* api.observations.request({
          payload: {
            interactionId: work.id,
            observerId: sam,
            mode: 'saw_it',
            skillIds,
            note: null,
          },
        });
      });
    /** As Sam: sign every rating at level 2 with the stored roles. */
    const sign = (view: ObservationView) =>
      Effect.gen(function* () {
        yield* signInAs('Sam Rivera');
        return yield* api.observations.sign({
          params: { id: view.id },
          payload: {
            version: view.version,
            mode: 'saw_it',
            ratings: view.ratings.map((r) => ({
              skillId: r.skill.id,
              level: 2 as const,
              indicatorIds: [],
              credit: true,
            })),
            narrativeSaw: NARRATIVE,
            narrativeNext: 'Ask what would change their mind before answering.',
          },
        });
      });
    return { db, api, tenantId, skillIdOf, on, ask, sign };
  });

  it.effect(
    'credit rules: a reasoned save bumps the version and is audited; meaningless values and stale saves are refused',
    () =>
      Effect.gen(function* () {
        const { db, api, tenantId } = yield* setup;
        yield* signInAs(PROGRAM_OWNER);
        const before = yield* api.program.creditPolicy();
        assert.deepInclude(before, { version: 1, valid: true, problems: [], history: [] });
        assert.deepStrictEqual(before.defaults, policy());

        const save = (values: ReturnType<typeof policy>, reason = REASON, expectedVersion = 1) =>
          api.program.saveCreditPolicy({ payload: { expectedVersion, policy: values, reason } });
        const refused = (values: ReturnType<typeof policy>, reason?: string) =>
          save(values, reason).pipe(
            Effect.flip,
            Effect.map((e) => [e._tag, e._tag === 'Unprocessable' ? e.field : null]),
          );
        // Every save needs a reason; a criterion must be able to mean something.
        assert.deepStrictEqual(yield* refused(policy(), 'Because.'), ['Unprocessable', 'reason']);
        assert.deepStrictEqual(yield* refused(policy({ minInteractions: 0 })), [
          'Unprocessable',
          'minInteractions',
        ]);
        assert.deepStrictEqual(yield* refused(policy({ minObservers: 0 })), [
          'Unprocessable',
          'minObservers',
        ]);
        assert.deepStrictEqual(yield* refused(policy({ minSpanDays: -1 })), [
          'Unprocessable',
          'minSpanDays',
        ]);
        assert.strictEqual((yield* inspectTenantCreditPolicy(tenantId)).version, 1);

        // Below every working default is a choice the experts may make: accepted and audited.
        const loose = policy({
          minInteractions: 1,
          minObservers: 1,
          minSpanDays: 0,
          badgePoints: 10,
        });
        const saved = yield* save(loose);
        assert.strictEqual(saved.version, 2);
        assert.deepInclude(saved.stored, loose);
        const [change] = saved.history;
        assert.strictEqual(change?.actor?.displayName, PROGRAM_OWNER);
        assert.strictEqual(change?.reason, REASON);
        assert.deepStrictEqual(
          change?.changes.map((c) => [c.field, c.before, c.after]),
          [
            ['badgePoints', 30, 10],
            ['minInteractions', 3, 1],
            ['minObservers', 2, 1],
            ['minSpanDays', 28, 0],
          ],
        );
        const [audit] = yield* db
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.tenantId, tenantId),
              eq(schema.auditEvent.entityType, 'credit_policy'),
            ),
          );
        assert.deepInclude(audit, {
          entityId: tenantId,
          event: 'REPLACE',
          fromState: '1',
          toState: '2',
          reasonCode: 'note',
          policyVersion: creditPolicyVersion({ version: 2 }),
        });
        assert.deepStrictEqual(yield* tenantCreditPolicy(tenantId), { ...loose, version: 2 });

        // An editor still holding version 1 cannot overwrite version 2.
        const stale = yield* save(policy()).pipe(Effect.flip);
        assert.strictEqual(stale._tag, 'Conflict');
        // Back to the working defaults for the rest of the journey.
        assert.strictEqual((yield* save(policy(), REASON, 2)).version, 3);
      }),
  );

  it.effect('a broken stored policy is reported, not repaired, until a save repairs it', () =>
    Effect.gen(function* () {
      const { db, api, tenantId } = yield* setup;
      yield* db
        .update(schema.tenant)
        .set({ settings: sql`${schema.tenant.settings} #- '{creditPolicy,minObservers}'` })
        .where(eq(schema.tenant.id, tenantId));
      yield* signInAs(PROGRAM_OWNER);
      const broken = yield* api.program.creditPolicy();
      assert.deepInclude(broken, { version: 3, valid: false });
      assert.deepStrictEqual(
        broken.problems.map((p) => p.field),
        ['minObservers'],
      );
      assert.isNull(broken.stored.minObservers);
      assert.strictEqual(broken.stored.minInteractions, DEFAULT_CREDIT_POLICY.minInteractions);
      // Reading it changed nothing: still broken, nothing filled in.
      assert.isFalse((yield* inspectTenantCreditPolicy(tenantId)).reading.ok);

      const repaired = yield* api.program.saveCreditPolicy({
        payload: { expectedVersion: broken.version, policy: policy(), reason: REASON },
      });
      assert.deepInclude(repaired, { version: 4, valid: true, problems: [] });
      // The repair records the missing field as it was: absent.
      assert.deepStrictEqual(repaired.history[0]?.changes, [
        { field: 'minObservers', before: null, after: DEFAULT_CREDIT_POLICY.minObservers },
      ]);
    }),
  );

  it.effect(
    'a skill is published as version 1, then as immutable version 2; observations keep the version they pinned; retiring stops new use',
    () =>
      Effect.gen(function* () {
        const { db, api, skillIdOf, on, ask, sign } = yield* setup;
        yield* signInAs(PROGRAM_OWNER);
        const created = yield* api.program.createSkill({
          payload: {
            name: 'Handling objections',
            summary: 'Hears a client’s objection out and answers it with their own goals.',
            domain: 'communication',
            outcome: 'Client trust',
            tags: ['meetings'],
          },
        });
        assert.deepInclude(created, {
          slug: 'handling-objections',
          status: 'draft',
          currentVersion: null,
          draftComplete: false,
        });
        assert.deepStrictEqual(created.actions, ['DISCARD']);
        const early = yield* api.program
          .skillTransition({
            params: { slug: created.slug },
            payload: { version: created.version, event: 'PUBLISH', note: null },
          })
          .pipe(Effect.flip);
        assert.strictEqual(early._tag, 'InvalidTransition');

        const drafted = yield* api.program.updateSkill({
          params: { slug: created.slug },
          payload: {
            version: created.version,
            name: created.name,
            summary: created.summary,
            domain: created.domain,
            outcome: created.outcome,
            tags: [...created.tags],
            definition: levels('Objection'),
          },
        });
        assert.isTrue(drafted.draftComplete);
        assert.include(drafted.actions, 'PUBLISH');
        const v1 = yield* api.program.skillTransition({
          params: { slug: created.slug },
          payload: { version: drafted.version, event: 'PUBLISH', note: 'First version.' },
        });
        assert.deepInclude(v1, { status: 'published', currentVersion: 1, draft: null });
        assert.deepStrictEqual(v1.actions, ['RETIRE']);

        // Observers see it at once; Maya's open request pins version 1.
        const skillId = yield* skillIdOf(created.slug);
        const pending = yield* ask(5, [skillId]);
        const pinnedV1 = pending.ratings[0]?.skillVersionId;
        assert.isDefined(pinnedV1);

        // The next version keeps lineage for indicators that carry over.
        yield* signInAs(PROGRAM_OWNER);
        const [first, second, ...rest] = v1.published;
        assert.isDefined(first);
        assert.isDefined(second);
        const carried = (l: typeof first) => ({
          level: l.level,
          summary: l.summary,
          indicators: l.indicators.map((i) => ({ lineageKey: i.lineageKey, text: i.text })),
        });
        const edited = yield* api.program.updateSkill({
          params: { slug: created.slug },
          payload: {
            version: v1.version,
            name: v1.name,
            summary: v1.summary,
            domain: v1.domain,
            outcome: v1.outcome,
            tags: [...v1.tags],
            definition: [
              {
                ...carried(first),
                indicators: [
                  { lineageKey: first.indicators[0]!.lineageKey, text: 'Names the concern aloud' },
                ],
              },
              {
                ...carried(second),
                indicators: [
                  ...carried(second).indicators,
                  { lineageKey: null, text: 'Checks the answer landed' },
                ],
              },
              ...rest.map(carried),
            ],
          },
        });
        assert.isTrue(edited.hasDraft);
        assert.strictEqual(edited.currentVersion, 1);
        const v2 = yield* api.program.skillTransition({
          params: { slug: created.slug },
          payload: { version: edited.version, event: 'PUBLISH', note: 'Clearer level 1.' },
        });
        assert.deepStrictEqual(
          v2.versions.map((v) => [v.number, v.changeNote]),
          [
            [2, 'Clearer level 1.'],
            [1, 'First version.'],
          ],
        );
        const versions = yield* db
          .select()
          .from(schema.skillVersion)
          .where(eq(schema.skillVersion.skillId, skillId));
        const v1Id = versions.find((v) => v.number === 1)?.id;
        const v2Id = versions.find((v) => v.number === 2)?.id;
        assert.strictEqual(v1Id, pinnedV1);
        const indicatorsOf = (versionId: SkillVersionId | undefined) =>
          db
            .select()
            .from(schema.skillIndicator)
            .where(eq(schema.skillIndicator.skillVersionId, versionId as SkillVersionId));
        // Version 1 is untouched; version 2 has its own rows with the carried keys.
        assert.lengthOf(yield* indicatorsOf(v1Id), 8);
        const v2Indicators = yield* indicatorsOf(v2Id);
        assert.lengthOf(v2Indicators, 8);
        assert.include(
          v2Indicators.map((i) => i.lineageKey),
          first.indicators[0]!.lineageKey,
        );
        assert.notInclude(
          v2Indicators.map((i) => i.lineageKey),
          first.indicators[1]!.lineageKey,
        );
        assert.include(
          v2Indicators.map((i) => i.lineageKey),
          'l2-checks-the-answer-landed',
        );
        const published = yield* db
          .select()
          .from(schema.auditEvent)
          .where(
            and(eq(schema.auditEvent.entityId, skillId), eq(schema.auditEvent.event, 'PUBLISH')),
          );
        assert.lengthOf(published, 2);

        // The request made under version 1 is signed against version 1.
        const signed = yield* sign(pending);
        assert.strictEqual(signed.ratings[0]?.skillVersionId, v1Id);
        // A new request pins version 2.
        const later = yield* ask(3, [skillId]);
        assert.strictEqual(later.ratings[0]?.skillVersionId, v2Id);

        // Retired: no new plans, activities or observations; history still shows it.
        yield* signInAs(PROGRAM_OWNER);
        const retired = yield* api.program.skillTransition({
          params: { slug: created.slug },
          payload: { version: v2.version, event: 'RETIRE', note: 'Folded into client discovery.' },
        });
        assert.deepInclude(retired, { status: 'retired', canEdit: false });
        assert.deepStrictEqual(retired.actions, []);
        yield* signInAs('Maya Chen');
        const refusals = [
          yield* ask(2, [skillId]).pipe(Effect.flip),
          yield* api.development
            .logInteraction({
              payload: {
                activityId: null,
                adHocTitle: 'Objection call',
                adHocSkillIds: [skillId],
                occurredOn: addDaysIso(on, -1),
                kind: 'client_meeting',
                clientRef: null,
                reflection: 'Took a call about fees and answered the objection.',
              },
            })
            .pipe(Effect.flip),
          yield* api.development
            .createPlan({
              payload: {
                title: 'Objections',
                intent: 'Handle objections well.',
                periodStart: on,
                periodEnd: addDaysIso(on, 90),
                focusSkills: [{ skillId, targetLevel: 2 }],
              },
            })
            .pipe(Effect.flip),
        ];
        assert.deepStrictEqual(
          refusals.map((e) => [e._tag, e._tag === 'Unprocessable' ? e.field : null]),
          [
            ['Unprocessable', 'skills'],
            ['Unprocessable', 'skills'],
            ['Unprocessable', 'skills'],
          ],
        );
        assert.notInclude(
          (yield* api.catalog.skills({ query: {} })).map((s) => s.slug),
          created.slug,
        );
        const history = yield* api.observations.get({ params: { id: signed.id } });
        assert.strictEqual(history.ratings[0]?.skill.slug, created.slug);
      }),
  );

  it.effect(
    'a template lists each skill once, at most one primary, published skills only; an edit is audited',
    () =>
      Effect.gen(function* () {
        const { api, skillIdOf } = yield* setup;
        const [discovery, explaining, retired] = [
          yield* skillIdOf('client-discovery'),
          yield* skillIdOf('explaining-simply'),
          yield* skillIdOf('handling-objections'),
        ];
        yield* signInAs(PROGRAM_OWNER);
        const draftSkill = yield* api.program.createSkill({
          payload: {
            name: 'Fee conversations',
            summary: 'Explains fees plainly and early, before a client has to ask.',
            domain: 'trust_integrity',
            outcome: 'Client trust',
            tags: [],
          },
        });
        const refused = (skills: Parameters<typeof templateInput>[0]) =>
          api.program.createTemplate({ payload: templateInput(skills) }).pipe(
            Effect.flip,
            Effect.map((e) => [e._tag, e._tag === 'Unprocessable' ? e.field : null]),
          );
        const unprocessable = ['Unprocessable', 'skills'];
        assert.deepStrictEqual(
          yield* refused([
            [discovery, 'primary', null],
            [explaining, 'primary', null],
          ]),
          unprocessable,
        );
        assert.deepStrictEqual(
          yield* refused([[yield* skillIdOf(draftSkill.slug), 'primary', null]]),
          unprocessable,
        );
        assert.deepStrictEqual(yield* refused([[retired, 'primary', null]]), unprocessable);

        const created = yield* api.program.createTemplate({
          payload: templateInput([
            [discovery, 'primary', 12],
            [explaining, 'secondary', null],
          ]),
        });
        assert.deepInclude(created, {
          status: 'draft',
          slug: 'first-meeting-with-a-referred-client',
        });
        assert.sameMembers([...created.actions], ['PUBLISH', 'DISCARD']);
        const published = yield* api.program.templateTransition({
          params: { id: created.id },
          payload: { version: created.version, event: 'PUBLISH', note: null },
        });
        yield* signInAs('Maya Chen');
        const card = (yield* api.catalog.templates({ query: {} })).find((t) => t.id === created.id);
        assert.deepStrictEqual(
          card?.skills.map((s) => [s.skill.slug, s.role, s.points]),
          [
            ['client-discovery', 'primary', 12],
            ['explaining-simply', 'secondary', null],
          ],
        );

        yield* signInAs(PROGRAM_OWNER);
        const edited = yield* api.program.updateTemplate({
          params: { id: created.id },
          payload: {
            ...templateInput([
              [discovery, 'primary', 15],
              [explaining, 'secondary', null],
            ]),
            version: published.version,
          },
        });
        assert.strictEqual(edited.status, 'published');
        assert.deepStrictEqual(edited.history[0]?.changes, [
          {
            field: 'skills',
            before: 'client-discovery primary 12; explaining-simply secondary',
            after: 'client-discovery primary 15; explaining-simply secondary',
          },
        ]);
        const stale = yield* api.program
          .updateTemplate({
            params: { id: created.id },
            payload: {
              ...templateInput([[discovery, 'primary', null]]),
              version: published.version,
            },
          })
          .pipe(Effect.flip);
        assert.strictEqual(stale._tag, 'Conflict');
      }),
  );

  it.effect(
    'a credit signed after a skill’s value changes uses the new value; earlier credit keeps its own',
    () =>
      Effect.gen(function* () {
        const { db, api, skillIdOf, ask, sign } = yield* setup;
        const [discovery, planning] = [
          yield* skillIdOf('client-discovery'),
          yield* skillIdOf('goals-based-planning'),
        ];
        const goalsCredit = (view: { readonly credits: ObservationView['credits'] }) =>
          view.credits.find((c) => c.skill.id === planning);
        const before = yield* sign(yield* ask(6, [discovery, planning]));
        assert.deepInclude(goalsCredit(before), {
          role: 'secondary',
          points: 3,
          pointsSource: 'tenant',
        });

        yield* signInAs(PROGRAM_OWNER);
        const skill = yield* api.program.skill({ params: { slug: 'goals-based-planning' } });
        const values = {
          primaryPoints: null,
          secondaryPoints: 6,
          badgePoints: null,
          minPrimaryPoints: null,
        };
        const set = (v: typeof values, reason: string) =>
          api.program.setSkillValues({
            params: { slug: skill.slug },
            payload: { version: skill.version, values: v, reason },
          });
        assert.strictEqual(
          (yield* set(values, 'Worth it.').pipe(Effect.flip))._tag,
          'Unprocessable',
        );
        const zero = yield* set({ ...values, secondaryPoints: 0 }, REASON).pipe(Effect.flip);
        assert.deepInclude(zero, { _tag: 'Unprocessable', field: 'secondaryPoints' });
        const changed = yield* set(values, REASON);
        assert.deepInclude(changed.values, values);
        assert.deepInclude(changed.history[0], { event: 'SET_VALUES', reason: REASON });

        const after = yield* sign(yield* ask(4, [discovery, planning]));
        assert.deepInclude(goalsCredit(after), {
          role: 'secondary',
          points: 6,
          pointsSource: 'skill',
        });
        const [frozen] = yield* db
          .select()
          .from(schema.creditEntry)
          .where(
            and(
              eq(schema.creditEntry.observationId, before.id),
              eq(schema.creditEntry.skillId, planning),
            ),
          );
        assert.strictEqual(frozen?.points, 3);

        // The browse screen shows the value that differs from the tenant's.
        yield* signInAs('Maya Chen');
        const detail = yield* api.catalog.skill({ params: { slug: 'goals-based-planning' } });
        assert.deepStrictEqual(detail.valueDifferences, [
          { key: 'secondaryPoints', value: 6, tenantValue: DEFAULT_CREDIT_POLICY.secondaryPoints },
        ]);
      }),
  );

  it.effect('another tenant’s program owner can neither see nor change this tenant’s program', () =>
    Effect.gen(function* () {
      const { db, api, tenantId } = yield* setup;
      const { tenantId: otherTenant } = yield* seedSecondTenant;
      const [skill] = yield* db
        .select()
        .from(schema.skill)
        .where(and(eq(schema.skill.tenantId, tenantId), eq(schema.skill.slug, 'client-discovery')));
      const [template] = yield* db
        .select()
        .from(schema.activityTemplate)
        .where(eq(schema.activityTemplate.tenantId, tenantId));
      assert.isDefined(skill);
      assert.isDefined(template);
      const policyBefore = yield* inspectTenantCreditPolicy(tenantId);

      yield* signInAs(OUTSIDER);
      assert.deepStrictEqual((yield* api.program.skills()).skills, []);
      assert.deepStrictEqual(yield* api.program.templates(), []);
      const attempts = [
        yield* api.program
          .skillTransition({
            params: { slug: skill.slug },
            payload: { version: skill.version, event: 'RETIRE', note: null },
          })
          .pipe(Effect.flip),
        yield* api.program
          .setSkillValues({
            params: { slug: skill.slug },
            payload: {
              version: skill.version,
              values: {
                primaryPoints: 50,
                secondaryPoints: null,
                badgePoints: null,
                minPrimaryPoints: null,
              },
              reason: REASON,
            },
          })
          .pipe(Effect.flip),
        yield* api.program
          .templateTransition({
            params: { id: template.id },
            payload: { version: template.version, event: 'RETIRE', note: null },
          })
          .pipe(Effect.flip),
      ];
      assert.deepStrictEqual(
        attempts.map((e) => e._tag),
        ['NotFound', 'NotFound', 'NotFound'],
      );
      // Their save changes their own tenant's policy only.
      const own = yield* api.program.creditPolicy();
      yield* api.program.saveCreditPolicy({
        payload: {
          expectedVersion: own.version,
          policy: policy({ primaryPoints: 50 }),
          reason: REASON,
        },
      });
      assert.strictEqual((yield* tenantCreditPolicy(otherTenant)).primaryPoints, 50);
      assert.deepStrictEqual(yield* inspectTenantCreditPolicy(tenantId), policyBefore);
      const [unchanged] = yield* db
        .select()
        .from(schema.skill)
        .where(eq(schema.skill.id, skill.id));
      assert.deepInclude(unchanged, { status: 'published', primaryPoints: null });
    }),
  );
});
