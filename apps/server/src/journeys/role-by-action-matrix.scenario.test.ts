import { Api } from '@repo/api';
import {
  DEFAULT_CREDIT_POLICY,
  PersonId,
  RoleGrantId,
  type EvidenceId,
  type GrantRole,
  type IsoDate,
  type ObservationId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, asc, eq, inArray, isNull, like } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { inspectTenantCreditPolicy } from '../features/shared/recognition.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Separation of duties as one table (I31): personas that each hold exactly
 * one capability, against every sensitive action. A cell is `allowed`, `levels
 * only` (the observation is visible but its words are not), or the tag of the
 * refusal. A resource someone may not see at all is `NotFound`, never a hint
 * that it exists. Refused attempts run first, so an allowed cell's write never
 * decides another cell.
 */
const client = HttpApiTest.groups(Api, ['observations', 'admin', 'hub', 'directory', 'program']);

const PERSONAS = [
  'advisor',
  'coach',
  'leader',
  'tenant_admin',
  'compliance_reviewer',
  'program_owner',
] as const;
type Persona = (typeof PERSONAS)[number];
type Outcome = 'allowed' | 'levels only' | string;

/** People added only for this test: no relationships, one grant at most. */
const ADDED: ReadonlyArray<{ persona: Persona; name: string; grant: GrantRole | null }> = [
  { persona: 'advisor', name: 'Theo Marsh', grant: null },
  { persona: 'coach', name: 'Cara Moss', grant: 'coach' },
  { persona: 'tenant_admin', name: 'Ada Ruiz', grant: 'tenant_admin' },
  { persona: 'compliance_reviewer', name: 'Cole Ward', grant: 'compliance_reviewer' },
  { persona: 'program_owner', name: 'Pia Lund', grant: 'program_owner' },
];
/** A leader by relationship only (leads Tom, Marcus and Grace; holds no grant). */
const LEADER = 'Priya Raman';
const nameOf = (persona: Persona) =>
  persona === 'leader' ? LEADER : (ADDED.find((a) => a.persona === persona)?.name as string);

const A = 'allowed';
/** Program administration (design §7): program owners and tenant admins, nobody else. */
const PROGRAM_ONLY: Readonly<Record<Persona, Outcome>> = {
  advisor: 'Forbidden',
  coach: 'Forbidden',
  leader: 'Forbidden',
  tenant_admin: A,
  compliance_reviewer: 'Forbidden',
  program_owner: A,
};
const MATRIX: Readonly<Record<string, Readonly<Record<Persona, Outcome>>>> = {
  'read a narrative outside relationships': {
    advisor: 'NotFound',
    coach: 'NotFound',
    leader: 'NotFound',
    tenant_admin: 'levels only',
    compliance_reviewer: A,
    program_owner: 'NotFound',
  },
  'uphold an observation under review': {
    advisor: 'NotFound',
    coach: 'NotFound',
    leader: 'NotFound',
    tenant_admin: 'Forbidden',
    compliance_reviewer: A,
    program_owner: 'NotFound',
  },
  'void a signed observation': {
    advisor: 'NotFound',
    coach: 'NotFound',
    leader: 'NotFound',
    tenant_admin: 'Forbidden',
    compliance_reviewer: A,
    program_owner: 'NotFound',
  },
  'read the audit trail': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: A,
    program_owner: 'Forbidden',
  },
  'read AI usage': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: A,
    program_owner: 'Forbidden',
  },
  'read the adoption view': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: 'Forbidden',
    program_owner: A,
  },
  'run the directory import': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: 'Forbidden',
    program_owner: 'Forbidden',
  },
  'depart a person': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: 'Forbidden',
    program_owner: 'Forbidden',
  },
  'release held evidence': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: 'Forbidden',
    program_owner: 'Forbidden',
  },
  // Every program action (ADR 0023): the credit rules, skills and templates.
  'read the credit rules': PROGRAM_ONLY,
  'change the credit rules': PROGRAM_ONLY,
  'list skills in any state': PROGRAM_ONLY,
  'read a skill for administration': PROGRAM_ONLY,
  'add a skill to the catalog': PROGRAM_ONLY,
  'edit a skill draft': PROGRAM_ONLY,
  'publish a skill': PROGRAM_ONLY,
  'set a skill’s own values': PROGRAM_ONLY,
  'list activity templates in any state': PROGRAM_ONLY,
  'read an activity template for administration': PROGRAM_ONLY,
  'add an activity template': PROGRAM_ONLY,
  'edit an activity template': PROGRAM_ONLY,
  'publish an activity template': PROGRAM_ONLY,
};

const outcome = <E extends { readonly _tag: string }>(effect: Effect.Effect<unknown, E>) =>
  effect.pipe(
    Effect.as<Outcome>(A),
    Effect.catch((error) => Effect.succeed<Outcome>(error._tag)),
  );

layer(ScenarioLayer, { timeout: 120_000 })('role-by-action matrix', (it) => {
  it.effect('I31: each capability unlocks exactly its own sensitive actions', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const api = yield* client;
      const db = yield* Db;
      const maya = yield* signInAs('Maya Chen');
      const sam = yield* signInAs('Sam Rivera');
      const [anchor] = yield* db.select().from(schema.person).where(eq(schema.person.id, maya));
      const tenantId = anchor!.tenantId;
      const since = '2025-01-01' as IsoDate;
      const leaver = PersonId.generate();
      const added = ADDED.map((a) => ({ ...a, id: PersonId.generate() }));
      yield* db.insert(schema.person).values([
        ...added.map((a) => ({
          id: a.id,
          tenantId,
          email: `${a.name.toLowerCase().replace(' ', '.')}@northwind.example`,
          displayName: a.name,
        })),
        { id: leaver, tenantId, email: 'lee.vance@northwind.example', displayName: 'Lee Vance' },
      ]);
      yield* db.insert(schema.roleGrant).values(
        added.flatMap((a) =>
          a.grant
            ? [
                {
                  id: RoleGrantId.generate(),
                  tenantId,
                  personId: a.id,
                  role: a.grant,
                  validFrom: since,
                  source: 'seed',
                },
              ]
            : [],
        ),
      );

      // Targets: three signed observations of Maya by her coach (outside every persona's
      // relationships), one put under review by Maya, and Aisha's held reflection.
      const signed = yield* db
        .select({ id: schema.observation.id })
        .from(schema.observation)
        .where(
          and(
            eq(schema.observation.subjectId, maya),
            eq(schema.observation.observerId, sam),
            eq(schema.observation.status, 'signed'),
            isNull(schema.observation.acknowledgedAt),
          ),
        );
      assert.isAtLeast(signed.length, 2, 'the seed has signed observations of Maya');
      const voidTarget = signed[0]!.id as ObservationId;
      const reviewTarget = signed[1]!.id as ObservationId;
      yield* signInAs('Maya Chen');
      yield* api.observations.transition({
        params: { id: reviewTarget },
        payload: { event: 'REQUEST_REVIEW', note: 'That was a different meeting.' },
      });
      const [held] = yield* db
        .select({ id: schema.evidence.id })
        .from(schema.evidence)
        .where(and(eq(schema.evidence.tenantId, tenantId), eq(schema.evidence.status, 'held')));
      assert.isDefined(held, 'the seed has a held reflection');
      const evidenceId = held.id as EvidenceId;

      // Program targets: two complete skill drafts to publish (one per allowed persona),
      // a draft to edit, and two template drafts to publish.
      yield* signInAs(nameOf('program_owner'));
      yield* api.program.createSkill({
        payload: {
          name: 'Matrix edit target',
          summary: 'A skill draft the permission matrix edits.',
          domain: 'communication',
          outcome: 'Client trust',
          tags: [],
        },
      });
      for (const name of ['Matrix skill A', 'Matrix skill B']) {
        const draft = yield* api.program.createSkill({
          payload: {
            name,
            summary: 'A skill drafted for the permission matrix.',
            domain: 'communication',
            outcome: 'Client trust',
            tags: [],
          },
        });
        yield* api.program.updateSkill({
          params: { slug: draft.slug },
          payload: {
            version: draft.version,
            name,
            summary: draft.summary,
            domain: draft.domain,
            outcome: draft.outcome,
            tags: [],
            definition: ([1, 2, 3, 4] as const).map((level) => ({
              level,
              summary: `Level ${level}.`,
              indicators: [{ lineageKey: null, text: `Shows it at level ${level}` }],
            })),
          },
        });
      }
      const skillRow = (where: ReturnType<typeof and>) =>
        db
          .select()
          .from(schema.skill)
          .where(and(eq(schema.skill.tenantId, tenantId), where))
          .orderBy(asc(schema.skill.slug))
          .pipe(Effect.map((rows) => rows[0]!));
      const nextDraft = skillRow(
        and(like(schema.skill.slug, 'matrix-skill-%'), eq(schema.skill.status, 'draft')),
      );
      const planning = skillRow(eq(schema.skill.slug, 'goals-based-planning'));
      const editTarget = skillRow(eq(schema.skill.slug, 'matrix-edit-target'));
      const planningId = (yield* planning).id;
      const templateInput = (name: string) => ({
        name,
        description: 'A template drafted for the permission matrix.',
        kind: 'client_meeting' as const,
        observationTip: null,
        typicalMinutes: null,
        skills: [{ skillId: planningId, role: 'primary' as const, points: null }],
      });
      for (const name of ['Matrix template A', 'Matrix template B']) {
        yield* api.program.createTemplate({ payload: templateInput(name) });
      }
      const nextTemplateDraft = db
        .select()
        .from(schema.activityTemplate)
        .where(
          and(
            eq(schema.activityTemplate.tenantId, tenantId),
            like(schema.activityTemplate.slug, 'matrix-template-%'),
            eq(schema.activityTemplate.status, 'draft'),
          ),
        )
        .orderBy(asc(schema.activityTemplate.slug))
        .pipe(Effect.map((rows) => rows[0]!));
      const [template] = yield* db
        .select()
        .from(schema.activityTemplate)
        .where(eq(schema.activityTemplate.tenantId, tenantId))
        .orderBy(asc(schema.activityTemplate.slug));
      assert.isDefined(template);
      const templateSkills = yield* db
        .select()
        .from(schema.activityTemplateSkill)
        .where(eq(schema.activityTemplateSkill.templateId, template.id))
        .orderBy(asc(schema.activityTemplateSkill.position));
      const reason = 'Checked with the practice leads this week.';
      const { version: _, ...workingDefaults } = DEFAULT_CREDIT_POLICY;

      const ACTIONS: Readonly<Record<keyof typeof MATRIX, Effect.Effect<Outcome>>> = {
        'read a narrative outside relationships': api.observations
          .get({ params: { id: voidTarget } })
          .pipe(
            Effect.map((view): Outcome => (view.narrativeVisible ? A : 'levels only')),
            Effect.catch((error) => Effect.succeed<Outcome>(error._tag)),
          ),
        'uphold an observation under review': outcome(
          api.observations.transition({
            params: { id: reviewTarget },
            payload: { event: 'UPHOLD', note: 'Checked; it stands.' },
          }),
        ),
        'void a signed observation': outcome(
          api.observations.transition({
            params: { id: voidTarget },
            payload: { event: 'VOID', note: 'Recorded against the wrong person.' },
          }),
        ),
        'read the audit trail': outcome(api.admin.auditTrail({ query: {} })),
        'read AI usage': outcome(api.admin.aiUsage({ query: {} })),
        'read the adoption view': outcome(api.hub.adoption()),
        'run the directory import': outcome(
          api.directory.importDirectory({
            payload: {
              csv: 'email,display_name,title,location,business_function,manager_email,job_family',
              dryRun: true,
            },
          }),
        ),
        'depart a person': outcome(
          api.directory.departPerson({ params: { id: leaver }, payload: {} }),
        ),
        'release held evidence': outcome(
          api.admin.resolveEvidence({
            params: { id: evidenceId },
            payload: { event: 'RELEASE', reason: 'Checked: no client details.' },
          }),
        ),
        'read the credit rules': outcome(api.program.creditPolicy()),
        'change the credit rules': Effect.gen(function* () {
          const { version } = yield* Effect.provideService(
            inspectTenantCreditPolicy(tenantId),
            Db,
            db,
          );
          return yield* outcome(
            api.program.saveCreditPolicy({
              payload: { expectedVersion: version, policy: workingDefaults, reason },
            }),
          );
        }).pipe(Effect.orDie),
        'list skills in any state': outcome(api.program.skills()),
        'read a skill for administration': outcome(
          api.program.skill({ params: { slug: 'goals-based-planning' } }),
        ),
        'edit a skill draft': Effect.gen(function* () {
          const draft = yield* editTarget;
          return yield* outcome(
            api.program.updateSkill({
              params: { slug: draft.slug },
              payload: {
                version: draft.version,
                name: draft.name,
                summary: draft.summary,
                domain: 'communication',
                outcome: draft.outcome,
                tags: [],
                definition: null,
              },
            }),
          );
        }).pipe(Effect.orDie),
        'list activity templates in any state': outcome(api.program.templates()),
        'read an activity template for administration': outcome(
          api.program.template({ params: { id: template.id } }),
        ),
        'add an activity template': outcome(
          api.program.createTemplate({ payload: templateInput('Matrix created template') }),
        ),
        'publish an activity template': Effect.gen(function* () {
          const draft = yield* nextTemplateDraft;
          return yield* outcome(
            api.program.templateTransition({
              params: { id: draft.id },
              payload: { version: draft.version, event: 'PUBLISH', note: null },
            }),
          );
        }).pipe(Effect.orDie),
        'add a skill to the catalog': outcome(
          api.program.createSkill({
            payload: {
              name: 'Matrix added skill',
              summary: 'A skill added by the permission matrix.',
              domain: 'leadership',
              outcome: 'Team growth',
              tags: [],
            },
          }),
        ),
        'publish a skill': Effect.gen(function* () {
          const draft = yield* nextDraft;
          return yield* outcome(
            api.program.skillTransition({
              params: { slug: draft.slug },
              payload: { version: draft.version, event: 'PUBLISH', note: null },
            }),
          );
        }).pipe(Effect.orDie),
        'set a skill’s own values': Effect.gen(function* () {
          const skill = yield* planning;
          return yield* outcome(
            api.program.setSkillValues({
              params: { slug: skill.slug },
              payload: {
                version: skill.version,
                values: {
                  primaryPoints: null,
                  secondaryPoints: null,
                  badgePoints: null,
                  minPrimaryPoints: null,
                },
                reason,
              },
            }),
          );
        }).pipe(Effect.orDie),
        'edit an activity template': Effect.gen(function* () {
          const [row] = yield* db
            .select()
            .from(schema.activityTemplate)
            .where(eq(schema.activityTemplate.id, template.id));
          return yield* outcome(
            api.program.updateTemplate({
              params: { id: template.id },
              payload: {
                version: row!.version,
                name: template.name,
                description: template.description,
                kind: template.kind as 'client_meeting',
                observationTip: template.observationTip,
                typicalMinutes: template.typicalMinutes,
                skills: templateSkills.map((t) => ({
                  skillId: t.skillId,
                  role: t.role as 'primary' | 'secondary',
                  points: t.points,
                })),
                reason,
              },
            }),
          );
        }).pipe(Effect.orDie),
      };

      const actual: Record<string, Record<Persona, Outcome>> = {};
      for (const [action, expected] of Object.entries(MATRIX)) {
        const row = {} as Record<Persona, Outcome>;
        // Refusals first: an allowed write (a void, a departure) must not decide another cell.
        const order = PERSONAS.toSorted(
          (a, b) => Number(expected[a] === A) - Number(expected[b] === A),
        );
        for (const persona of order) {
          yield* signInAs(nameOf(persona));
          row[persona] = yield* ACTIONS[action]!;
        }
        actual[action] = Object.fromEntries(PERSONAS.map((p) => [p, row[p]])) as Record<
          Persona,
          Outcome
        >;
      }
      assert.deepStrictEqual(actual, MATRIX);

      // The allowed writes happened, once each.
      const decided = yield* db
        .select({ id: schema.observation.id, status: schema.observation.status })
        .from(schema.observation)
        .where(inArray(schema.observation.id, [voidTarget, reviewTarget]));
      assert.sameDeepMembers(decided, [
        { id: voidTarget, status: 'voided' },
        { id: reviewTarget, status: 'signed' },
      ]);
      const [gone] = yield* db.select().from(schema.person).where(eq(schema.person.id, leaver));
      assert.strictEqual(gone?.status, 'departed');
      const matrixSkills = yield* db
        .select({ slug: schema.skill.slug, status: schema.skill.status })
        .from(schema.skill)
        .where(and(eq(schema.skill.tenantId, tenantId), like(schema.skill.slug, 'matrix-%')))
        .orderBy(asc(schema.skill.slug));
      assert.deepStrictEqual(matrixSkills, [
        { slug: 'matrix-added-skill', status: 'draft' },
        { slug: 'matrix-added-skill-2', status: 'draft' },
        { slug: 'matrix-edit-target', status: 'draft' },
        { slug: 'matrix-skill-a', status: 'published' },
        { slug: 'matrix-skill-b', status: 'published' },
      ]);
      const matrixTemplates = yield* db
        .select({ slug: schema.activityTemplate.slug, status: schema.activityTemplate.status })
        .from(schema.activityTemplate)
        .where(
          and(
            eq(schema.activityTemplate.tenantId, tenantId),
            like(schema.activityTemplate.slug, 'matrix-%'),
          ),
        )
        .orderBy(asc(schema.activityTemplate.slug));
      assert.deepStrictEqual(matrixTemplates, [
        { slug: 'matrix-created-template', status: 'draft' },
        { slug: 'matrix-created-template-2', status: 'draft' },
        { slug: 'matrix-template-a', status: 'published' },
        { slug: 'matrix-template-b', status: 'published' },
      ]);
    }),
  );
});
