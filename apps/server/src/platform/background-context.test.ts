import { layerTestDb } from '@repo/db/testing';
import { transactionally } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { Effect, Layer, Option, Ref } from 'effect';
import { SqlClient } from 'effect/sql';
import { Background } from './background.ts';
import { afterCommit } from './background-context.ts';

/**
 * `afterCommit` is what its name says (ADR 0003: never call a provider inside a
 * transaction). Work registered inside a transaction runs only after COMMIT,
 * outside the transaction, and sees what was committed; work registered in a
 * transaction that rolls back never runs; outside a transaction it runs at once.
 */
layer(Layer.mergeAll(layerTestDb, Background.layerInline))('afterCommit', (it) => {
  it.effect('runs after COMMIT and outside the transaction; dropped on rollback', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`create table after_commit_probe (id integer)`;
      const log = yield* Ref.make<ReadonlyArray<string>>([]);
      const note = (entry: string) => Ref.update(log, (all) => [...all, entry]);
      const work = (label: string) =>
        Effect.gen(function* () {
          const open = yield* Effect.serviceOption(sql.transactionService);
          const rows = yield* sql<{ n: number }>`select count(*)::int as n from after_commit_probe`;
          yield* note(
            `${label}: ${Option.isNone(open) ? 'no transaction' : 'in a transaction'}, ${rows[0]?.n} rows`,
          );
        });

      yield* transactionally(
        Effect.gen(function* () {
          yield* sql`insert into after_commit_probe values (1)`;
          yield* afterCommit(work('committed'));
          yield* note('transaction body done');
        }),
      );
      assert.deepStrictEqual(yield* Ref.get(log), [
        'transaction body done',
        'committed: no transaction, 1 rows',
      ]);

      const failed = yield* transactionally(
        Effect.gen(function* () {
          yield* sql`insert into after_commit_probe values (2)`;
          yield* afterCommit(work('rolled back'));
          return yield* Effect.fail('abort' as const);
        }),
      ).pipe(Effect.flip);
      assert.strictEqual(failed, 'abort');

      yield* afterCommit(work('outside'));
      assert.deepStrictEqual(yield* Ref.get(log), [
        'transaction body done',
        'committed: no transaction, 1 rows',
        'outside: no transaction, 1 rows',
      ]);
    }),
  );
});
