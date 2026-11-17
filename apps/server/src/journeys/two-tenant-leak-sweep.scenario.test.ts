import { Api } from '@repo/api';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { eq, getTableColumns } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { Effect } from 'effect';
import { HttpApi, HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';
import { OUTSIDER, seedSecondTenant } from '../test/second-tenant.ts';

/**
 * Journey: a person in another tenant probes every GET endpoint in the
 * contract. Protects I9 (tenancy is structural) at the HTTP boundary: asked
 * for tenant A's ids, every endpoint answers 403 or 404, and no response
 * carries a tenant-A id, name or email. The endpoint list comes from the
 * contract, so a new GET endpoint is swept without editing this file, and a
 * new kind of path parameter fails until it is mapped below.
 */

/** Unauthenticated, development-only persona picker: lists every tenant by design (ADR 0014). */
const EXEMPT = new Set(['auth.devPersonas']);

/** Where tenant A's values for each path parameter come from, keyed by the path segment before it. */
const PARAM_SOURCES: Readonly<Record<string, { table: PgTable; column: string }>> = {
  observations: { table: schema.observation, column: 'id' },
  people: { table: schema.person, column: 'id' },
  interactions: { table: schema.interaction, column: 'id' },
  conversations: { table: schema.coachingConversation, column: 'id' },
  badges: { table: schema.badgeAward, column: 'id' },
  skills: { table: schema.skill, column: 'slug' },
};
const SAMPLES_PER_PARAM = 4;

/** Same shape (prefix, length, alphabet), but no row has it: the random part reversed. */
const nonexistent = (value: string) => {
  const cut = value.indexOf('_') + 1;
  return value.slice(0, cut) + value.slice(cut).split('').toReversed().join('');
};

interface Get {
  readonly key: string;
  readonly group: string;
  readonly endpoint: string;
  readonly path: string;
}

const gets: Array<Get> = [];
HttpApi.reflect(Api, {
  onGroup: () => undefined,
  onEndpoint: ({ group, endpoint }) => {
    if (endpoint.method !== 'GET') return;
    const key = `${group.identifier}.${endpoint.identifier}`;
    if (!EXEMPT.has(key))
      gets.push({
        key,
        group: group.identifier,
        endpoint: endpoint.identifier,
        path: endpoint.path,
      });
  },
});

const column = (table: PgTable, name: string) => {
  const found = getTableColumns(table)[name];
  if (!found) throw new Error(`${getTableConfig(table).name} has no column ${name}`);
  return found;
};

/** `[name, segment before it]` for each `:param` in a path. */
const paramsOf = (path: string) => {
  const segments = path.split('/');
  return segments.flatMap((segment, i) =>
    segment.startsWith(':') ? [[segment.slice(1), segments[i - 1] ?? ''] as const] : [],
  );
};

const client = HttpApiTest.groups(Api, [
  'auth',
  'session',
  'support',
  'catalog',
  'people',
  'development',
  'observations',
  'admin',
  'rhythm',
  'hub',
]);

layer(ScenarioLayer, { timeout: 120_000 })('two-tenant leak sweep', (it) => {
  it.effect('every GET endpoint refuses tenant A’s ids to a tenant-B user and leaks nothing', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const { tenantId: tenantB } = yield* seedSecondTenant;
      const db = yield* Db;
      const [tenantA] = (yield* db.select().from(schema.tenant)).filter((t) => t.id !== tenantB);
      assert.isDefined(tenantA);

      // Every id in tenant A, from every tenant-scoped table, plus names and emails.
      const secrets = new Set<string>([tenantA.id, tenantA.name]);
      for (const value of Object.values(schema)) {
        if (!(value instanceof PgTable)) continue;
        const columns = getTableConfig(value).columns.map((c) => c.name);
        if (!columns.includes('tenant_id') || !columns.includes('id')) continue;
        const rows = yield* db
          .select({ id: column(value, 'id') })
          .from(value)
          .where(eq(column(value, 'tenantId'), tenantA.id));
        for (const row of rows) secrets.add(String(row.id));
      }
      for (const person of yield* db
        .select()
        .from(schema.person)
        .where(eq(schema.person.tenantId, tenantA.id))) {
        secrets.add(person.displayName);
        secrets.add(person.email);
      }

      const samples = new Map<string, Array<string>>();
      for (const [segment, source] of Object.entries(PARAM_SOURCES)) {
        const rows = yield* db
          .select({ value: column(source.table, source.column) })
          .from(source.table)
          .where(eq(column(source.table, 'tenantId'), tenantA.id))
          .limit(SAMPLES_PER_PARAM);
        samples.set(
          segment,
          rows.map((r) => String(r.value)),
        );
      }

      yield* signInAs(OUTSIDER);
      const api = (yield* client) as unknown as Record<
        string,
        Record<string, (request: unknown) => Effect.Effect<unknown, { _tag?: string }>>
      >;

      const leaks: Array<string> = [];
      const unmapped: Array<string> = [];
      const unexercised: Array<string> = [];
      for (const get of gets) {
        const params = paramsOf(get.path);
        const missing = params.filter(([, segment]) => !(segment in PARAM_SOURCES));
        if (missing.length > 0) {
          unmapped.push(`${get.key} (${get.path})`);
          continue;
        }
        // One round per sample row; a parameter with no tenant-A rows cannot be probed.
        const rounds = Math.min(...params.map(([, s]) => samples.get(s)?.length ?? 0), Infinity);
        if (params.length > 0 && rounds === 0) {
          unexercised.push(get.key);
          continue;
        }
        const ask = (values: Readonly<Record<string, string>>) =>
          (
            api[get.group]?.[get.endpoint]?.(params.length > 0 ? { params: values } : {}) ??
            Effect.die(`no client method for ${get.key}`)
          ).pipe(
            Effect.match({
              onSuccess: (body) => `OK ${JSON.stringify(body) ?? ''}`,
              onFailure: (error) => String(error?._tag ?? error),
            }),
          );
        for (let round = 0; round < (params.length > 0 ? rounds : 1); round++) {
          const values = Object.fromEntries(
            params.map(([name, segment]) => [name, samples.get(segment)?.[round] ?? '']),
          );
          const target = `${get.key} ${JSON.stringify(values)}`;
          const answer = yield* ask(values);
          const found = [...secrets].filter((secret) => answer.includes(secret));
          if (found.length > 0)
            leaks.push(`${target} returned tenant A's ${found.slice(0, 3).join(', ')}`);
          if (params.length === 0) continue;
          // Tenant A's ids must be indistinguishable from ids that exist nowhere.
          const nowhere = yield* ask(
            Object.fromEntries(Object.entries(values).map(([k, v]) => [k, nonexistent(v)])),
          );
          if (answer !== nowhere)
            leaks.push(
              `${target} answered ${answer.slice(0, 80)} but a non-existent id gets ${nowhere.slice(0, 80)}`,
            );
          if (answer.startsWith('OK') && !/^OK (\[\]|null)$/.test(answer))
            leaks.push(`${target} answered with content: ${answer.slice(0, 80)}`);
        }
      }

      assert.deepStrictEqual(unmapped, [], 'map these path parameters in PARAM_SOURCES');
      assert.deepStrictEqual(leaks, []);
      // The seed has rows for every mapped kind; an empty sample would make the sweep vacuous.
      assert.deepStrictEqual(unexercised, []);
      assert.isAbove(gets.length, 15);
    }),
  );
});
