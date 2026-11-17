import { TenantId } from '@repo/domain';
import { assert, layer } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { Db, schema, transactionally } from './index.ts';
import { layerTestDb } from './testing.ts';

layer(layerTestDb)('database', (it) => {
  it.effect('applies migrations and runs typed queries', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const id = TenantId.generate();
      yield* db.insert(schema.tenant).values({ id, name: 'Acme Wealth', slug: 'acme' });
      const rows = yield* db.select().from(schema.tenant).where(eq(schema.tenant.id, id));
      assert.strictEqual(rows[0]?.name, 'Acme Wealth');
    }),
  );

  it.effect('rolls back queries made through Db inside transactionally()', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const id = TenantId.generate();
      const result = yield* transactionally(
        Effect.gen(function* () {
          // Uses the ambient Db, not a `tx` handle: it must still join the transaction.
          yield* db.insert(schema.tenant).values({ id, name: 'Rolled back', slug: 'rollback' });
          return yield* Effect.fail('boom' as const);
        }),
      ).pipe(Effect.flip);
      assert.strictEqual(result, 'boom');
      const rows = yield* db.select().from(schema.tenant).where(eq(schema.tenant.id, id));
      assert.strictEqual(rows.length, 0);
    }),
  );

  it.effect('enforces one current plan per person in the database', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const rows = yield* db.execute<{ indexname: string }>(
        `select indexname from pg_indexes where indexname = 'plan_one_current_per_owner'`,
      );
      assert.ok(JSON.stringify(rows).includes('plan_one_current_per_owner'));
    }),
  );
});
