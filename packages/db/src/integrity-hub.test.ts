import {
  DesignationId,
  NotificationId,
  PersonId,
  PositionId,
  TenantId,
  type IsoDate,
} from '@repo/domain';
import { assert, layer } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { Db, schema } from './index.ts';
import { layerTestDb } from './testing.ts';

/**
 * The hub round's integrity rules (migration `*_hub_integrity`), each proven by
 * attempted violation. Invariants in docs/testing/invariants.md.
 */
const d = (s: string) => s as IsoDate;

const rejected = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => false),
    Effect.catch(() => Effect.succeed(true)),
  );

const people = Effect.gen(function* () {
  const db = yield* Db;
  const tenantId = TenantId.generate();
  const [leader, ada, kim, sam] = [0, 1, 2, 3].map(() => PersonId.generate());
  yield* db.insert(schema.tenant).values({ id: tenantId, name: 'T', slug: `t-${tenantId}` });
  yield* db.insert(schema.person).values(
    [leader, ada, kim, sam].map((id) => ({
      id: id!,
      tenantId,
      email: `${id}@x.test`,
      displayName: id!,
    })),
  );
  return { tenantId, leader: leader!, ada: ada!, kim: kim!, sam: sam! };
});

layer(layerTestDb)('hub integrity', (it) => {
  it.effect('I21: designations never overlap between two people, in either direction', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const { tenantId, leader, ada, kim, sam } = yield* people;
      const designation = (observerId: PersonId, subjectId: PersonId, from: string, to: string) =>
        db.insert(schema.observerDesignation).values({
          id: DesignationId.generate(),
          tenantId,
          observerId,
          subjectId,
          designatedById: leader,
          designatorBasis: 'leader',
          validFrom: d(from),
          validTo: d(to),
        });
      yield* designation(kim, ada, '2026-06-01', '2026-07-01');
      // Same pair, same direction, overlapping.
      assert.isTrue(yield* rejected(designation(kim, ada, '2026-06-15', '2026-07-15')));
      // Reverse direction, overlapping: the anti-collusion rule.
      assert.isTrue(yield* rejected(designation(ada, kim, '2026-06-15', '2026-07-15')));
      // Adjacent windows (half-open) and other pairs are fine.
      yield* designation(kim, ada, '2026-07-01', '2026-08-01');
      yield* designation(sam, ada, '2026-06-01', '2026-07-01');
      // Longer than 90 days, or designating oneself.
      assert.isTrue(yield* rejected(designation(sam, kim, '2026-01-01', '2026-06-01')));
      assert.isTrue(yield* rejected(designation(ada, ada, '2026-09-01', '2026-09-10')));
    }),
  );

  it.effect('I21: a designation can only be ended early, once', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const { tenantId, leader, ada, kim, sam } = yield* people;
      const id = DesignationId.generate();
      yield* db.insert(schema.observerDesignation).values({
        id,
        tenantId,
        observerId: kim,
        subjectId: ada,
        designatedById: leader,
        designatorBasis: 'leader',
        validFrom: d('2026-06-01'),
        validTo: d('2026-07-01'),
      });
      const byId = eq(schema.observerDesignation.id, id);
      assert.isTrue(
        yield* rejected(db.update(schema.observerDesignation).set({ observerId: sam }).where(byId)),
      );
      assert.isTrue(yield* rejected(db.delete(schema.observerDesignation).where(byId)));
      yield* db
        .update(schema.observerDesignation)
        .set({ endedOn: d('2026-06-10') })
        .where(byId);
      assert.isTrue(
        yield* rejected(
          db
            .update(schema.observerDesignation)
            .set({ endedOn: d('2026-06-20') })
            .where(byId),
        ),
      );
    }),
  );

  it.effect('a person holds one position at a time', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const { tenantId, ada } = yield* people;
      const position = (from: string, to: string | null) =>
        db.insert(schema.personPosition).values({
          id: PositionId.generate(),
          tenantId,
          personId: ada,
          title: 'Advisor',
          validFrom: d(from),
          validTo: to === null ? null : d(to),
          source: 'seed',
        });
      yield* position('2025-01-01', '2026-04-01');
      yield* position('2026-04-01', null);
      assert.isTrue(yield* rejected(position('2026-03-01', '2026-05-01')));
    }),
  );

  it.effect('I20: a notification has no free-text column and rejects free text in its keys', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const { tenantId, ada, kim } = yield* people;
      // Adding a free-text column to the outbox must be a deliberate change here and in ADR 0018.
      const columns = getTableConfig(schema.notification).columns.map((c) => c.name);
      assert.deepStrictEqual(columns.toSorted(), [
        'actor_id',
        'attempts',
        'channel',
        'created_at',
        'dedupe_key',
        'due_on',
        'entity_id',
        'entity_type',
        'id',
        'item_count',
        'kind',
        'recipient_id',
        'send_after',
        'sent_at',
        'status',
        'tenant_id',
      ]);
      const insert = (entityId: string | null, dedupeKey: string) =>
        db.insert(schema.notification).values({
          id: NotificationId.generate(),
          tenantId,
          recipientId: ada,
          actorId: kim,
          kind: 'observation_signed',
          entityType: 'observation',
          entityId,
          dedupeKey,
        });
      yield* insert('obs_0123456789abcdef', 'observation_signed:obs_0123456789abcdef');
      assert.isTrue(yield* rejected(insert('Client J. Smith called', 'observation_signed:x')));
      assert.isTrue(yield* rejected(insert('obs_0123456789abcdef', 'Great work with the Smiths')));
    }),
  );
});
