import { Api } from '@repo/api';
import {
  PersonId,
  RoleGrantId,
  type EvidenceId,
  type GrantRole,
  type IsoDate,
  type ObservationId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
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
const client = HttpApiTest.groups(Api, ['observations', 'admin', 'hub', 'directory']);

const PERSONAS = [
  'advisor',
  'coach',
  'leader',
  'catalog_keeper',
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
  { persona: 'catalog_keeper', name: 'Ken Ito', grant: 'catalog_keeper' },
  { persona: 'tenant_admin', name: 'Ada Ruiz', grant: 'tenant_admin' },
  { persona: 'compliance_reviewer', name: 'Cole Ward', grant: 'compliance_reviewer' },
  { persona: 'program_owner', name: 'Pia Lund', grant: 'program_owner' },
];
/** A leader by relationship only (leads Tom, Marcus and Grace; holds no grant). */
const LEADER = 'Priya Raman';
const nameOf = (persona: Persona) =>
  persona === 'leader' ? LEADER : (ADDED.find((a) => a.persona === persona)?.name as string);

const A = 'allowed';
const MATRIX: Readonly<Record<string, Readonly<Record<Persona, Outcome>>>> = {
  'read a narrative outside relationships': {
    advisor: 'NotFound',
    coach: 'NotFound',
    leader: 'NotFound',
    catalog_keeper: 'NotFound',
    tenant_admin: 'levels only',
    compliance_reviewer: A,
    program_owner: 'NotFound',
  },
  'uphold an observation under review': {
    advisor: 'NotFound',
    coach: 'NotFound',
    leader: 'NotFound',
    catalog_keeper: 'NotFound',
    tenant_admin: 'Forbidden',
    compliance_reviewer: A,
    program_owner: 'NotFound',
  },
  'void a signed observation': {
    advisor: 'NotFound',
    coach: 'NotFound',
    leader: 'NotFound',
    catalog_keeper: 'NotFound',
    tenant_admin: 'Forbidden',
    compliance_reviewer: A,
    program_owner: 'NotFound',
  },
  'read the audit trail': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    catalog_keeper: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: A,
    program_owner: 'Forbidden',
  },
  'read AI usage': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    catalog_keeper: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: A,
    program_owner: 'Forbidden',
  },
  'read the adoption view': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    catalog_keeper: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: 'Forbidden',
    program_owner: A,
  },
  'run the directory import': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    catalog_keeper: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: 'Forbidden',
    program_owner: 'Forbidden',
  },
  'depart a person': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    catalog_keeper: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: 'Forbidden',
    program_owner: 'Forbidden',
  },
  'release held evidence': {
    advisor: 'Forbidden',
    coach: 'Forbidden',
    leader: 'Forbidden',
    catalog_keeper: 'Forbidden',
    tenant_admin: A,
    compliance_reviewer: 'Forbidden',
    program_owner: 'Forbidden',
  },
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
    }),
  );
});
