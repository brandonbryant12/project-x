import type { PersonId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, asc, eq, gt } from 'drizzle-orm';
import { Clock, Deferred, Effect, Fiber, Layer, Option, Ref } from 'effect';
import { SqlClient } from 'effect/sql';
import { TestClock } from 'effect/testing';
import {
  CLAIM_LEASE_MS,
  MAX_ATTEMPTS,
  SEND_TIMEOUT_MS,
  runNotifications,
} from '../features/notifications/dispatcher.ts';
import { notify } from '../features/shared/notify.ts';
import { renderRow } from '../features/shared/notification-render.ts';
import {
  Notifier,
  NotifierMemory,
  NotifyFailed,
  type OutgoingMessage,
} from '../platform/notifier.ts';
import { fixedClock, now } from '../platform/time.ts';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime } from '../test/harness.ts';

/**
 * Journey: the outbox dispatcher claims a row, sends it with no transaction
 * open, then acknowledges it (ADR 0018). Delivery is at least once: a send
 * whose acknowledgement is lost is sent again when its lease ends, never
 * before; a failing send backs off and ends `failed`; a row that is claimed
 * and never acknowledged is failed at its next claim instead of looping; a
 * sender that outlived its lease cannot overwrite the row another dispatcher
 * finished. Concurrent dispatchers send each row once.
 */
const MINUTE = 60_000;

type Behaviour<R> = (message: OutgoingMessage) => Effect.Effect<void, NotifyFailed, R>;

/**
 * A transport that proves no transaction is open while it runs, records what
 * it was asked to send, then behaves as told.
 */
const transport = <R = never>(behaviour: Behaviour<R> = () => Effect.void) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // The services the behaviour needs (the database, the dispatcher's own).
    const context = yield* Effect.context<R>();
    const sent = yield* Ref.make<ReadonlyArray<OutgoingMessage>>([]);
    const service = Notifier.of({
      transport: 'memory',
      send: (message) =>
        Effect.gen(function* () {
          const open = yield* Effect.serviceOption(sql.transactionService);
          assert.isTrue(Option.isNone(open), 'the transport ran inside a database transaction');
          yield* Ref.update(sent, (all) => [...all, message]);
          yield* behaviour(message).pipe(Effect.provide(context));
        }),
    });
    return { service, sent };
  });

const runWith = (service: typeof Notifier.Service) =>
  runNotifications().pipe(Effect.provideService(Notifier, service));

/**
 * A new outbox row through `notify`, about a request that is still waiting,
 * for a recipient no other test uses. `matches` picks out its message.
 */
const freshRow = (recipientIndex: number) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const at = yield* now;
    const [request] = yield* db
      .select()
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.status, 'requested'),
          gt(schema.observation.dueAt, new Date(at.getTime() + 2 * 86_400_000)),
        ),
      )
      .orderBy(asc(schema.observation.id))
      .limit(1);
    assert.isDefined(request);
    const people = (yield* db
      .select({ id: schema.person.id })
      .from(schema.person)
      .where(eq(schema.person.tenantId, request.tenantId))
      .orderBy(asc(schema.person.id))).filter(
      // Neither party: the seed already enqueued (and the first test sent) their rows.
      (p) => p.id !== request.subjectId && p.id !== request.observerId,
    );
    const recipient = people[recipientIndex];
    assert.isDefined(recipient);
    yield* notify(request.tenantId, {
      recipientId: recipient.id,
      kind: 'observation_requested',
      entityType: 'observation',
      entityId: request.id,
      actorId: request.subjectId as PersonId,
    });
    const [row] = yield* db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.kind, 'observation_requested'),
          eq(schema.notification.entityId, request.id),
          eq(schema.notification.recipientId, recipient.id),
        ),
      );
    assert.deepStrictEqual([row?.status, row?.attempts], ['pending', 0]);
    assert.isDefined(row);
    const rendered = yield* renderRow(row, at);
    assert.isNotNull(rendered);
    const matches = (m: OutgoingMessage) =>
      m.to.personId === row.recipientId &&
      m.subject === rendered?.rendered.subject &&
      m.link === rendered.rendered.link;
    return { row, matches };
  });

const rowById = (id: typeof schema.notification.$inferSelect.id) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [row] = yield* db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.id, id));
    assert.isDefined(row);
    return row;
  });

const sentMatching = (
  sent: Ref.Ref<ReadonlyArray<OutgoingMessage>>,
  matches: (m: OutgoingMessage) => boolean,
) => Ref.get(sent).pipe(Effect.map((all) => all.filter(matches).length));

const drain = (service: typeof Notifier.Service) =>
  Effect.gen(function* () {
    while ((yield* runWith(service)) > 0) {
      /* keep going */
    }
  });

layer(ScenarioLayer.pipe(Layer.provideMerge(NotifierMemory)), { timeout: 60_000 })(
  'notification delivery is at least once',
  (it) => {
    it.effect('two dispatchers running at once send each row once', () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        yield* seedWorld;
        const db = yield* Db;
        // Yield inside the send so the other dispatcher claims while this one is sending.
        const { service, sent } = yield* transport(() => Effect.yieldNow);
        yield* Effect.all([drain(service), drain(service)], { concurrency: 'unbounded' });

        // The seed only enqueues; nothing was sent before this run.
        const rows = yield* db.select().from(schema.notification);
        const sentRows = rows.filter((r) => r.status === 'sent');
        const messages = yield* Ref.get(sent);
        assert.isAbove(sentRows.length, 3);
        assert.strictEqual(messages.length, sentRows.length);
        const distinct = new Set(messages.map((m) => `${m.to.personId}|${m.subject}|${m.link}`));
        assert.strictEqual(distinct.size, messages.length);
        assert.isTrue(sentRows.every((r) => r.attempts === 1 && r.sentAt !== null));
      }),
    );

    it.effect('the claim commits before the send; the transport holds no transaction', () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        const { row, matches } = yield* freshRow(0);
        const at = yield* now;
        const seen = yield* Ref.make<Array<typeof schema.notification.$inferSelect>>([]);
        // Reading the row from the transport waits for the connection on PGlite if a
        // transaction held it, and sees only committed state on Postgres.
        const { service } = yield* transport((message) =>
          matches(message)
            ? rowById(row.id).pipe(
                Effect.flatMap((r) => Ref.update(seen, (all) => [...all, r])),
                Effect.orDie,
              )
            : Effect.void,
        );
        yield* runWith(service);
        const [during] = yield* Ref.get(seen);
        assert.isDefined(during);
        assert.deepStrictEqual(
          [during.status, during.attempts, during.sendAfter.getTime()],
          ['pending', 1, at.getTime() + CLAIM_LEASE_MS],
        );
        const after = yield* rowById(row.id);
        assert.deepStrictEqual([after.status, after.attempts], ['sent', 1]);
      }),
    );

    it.effect(
      'a send whose acknowledgement is lost is sent again after the lease, not before',
      () =>
        Effect.gen(function* () {
          yield* atScenarioTime;
          const { row, matches } = yield* freshRow(1);
          // The relay accepts the message, then the process dies before acknowledging it.
          const crashing = yield* transport((message) =>
            matches(message) ? Effect.die('crashed after send') : Effect.void,
          );
          const crashed = yield* Effect.exit(runWith(crashing.service));
          assert.isTrue(crashed._tag === 'Failure');
          assert.strictEqual(yield* sentMatching(crashing.sent, matches), 1);
          assert.deepStrictEqual(
            [(yield* rowById(row.id)).status, (yield* rowById(row.id)).attempts],
            ['pending', 1],
          );

          const healthy = yield* transport();
          yield* TestClock.adjust(CLAIM_LEASE_MS - MINUTE);
          yield* runWith(healthy.service);
          assert.strictEqual(yield* sentMatching(healthy.sent, matches), 0);
          assert.strictEqual((yield* rowById(row.id)).status, 'pending');

          yield* TestClock.adjust(MINUTE);
          yield* runWith(healthy.service);
          assert.strictEqual(yield* sentMatching(healthy.sent, matches), 1);
          const after = yield* rowById(row.id);
          assert.deepStrictEqual([after.status, after.attempts], ['sent', 2]);
        }),
    );

    it.effect('a failing send backs off, then ends failed after the maximum attempts', () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        const { row, matches } = yield* freshRow(2);
        const refusing = yield* transport((message) =>
          matches(message) ? Effect.fail(new NotifyFailed({ reason: 'refused' })) : Effect.void,
        );
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          yield* runWith(refusing.service);
          const after = yield* rowById(row.id);
          assert.strictEqual(after.attempts, attempt);
          if (attempt === MAX_ATTEMPTS) {
            assert.deepStrictEqual([after.status, after.sentAt], ['failed', null]);
            break;
          }
          const backoff = 2 ** attempt * MINUTE;
          assert.deepStrictEqual(
            [after.status, after.sendAfter.getTime()],
            ['pending', (yield* Clock.currentTimeMillis) + backoff],
          );
          // Not retried before the backoff ends.
          yield* TestClock.adjust(backoff - MINUTE);
          yield* runWith(refusing.service);
          assert.strictEqual(yield* sentMatching(refusing.sent, matches), attempt);
          yield* TestClock.adjust(MINUTE);
        }
        assert.strictEqual(yield* sentMatching(refusing.sent, matches), MAX_ATTEMPTS);
        yield* TestClock.adjust(60 * MINUTE);
        yield* runWith(refusing.service);
        assert.strictEqual(yield* sentMatching(refusing.sent, matches), MAX_ATTEMPTS);
      }),
    );

    it.effect(
      'a row claimed the maximum times and never acknowledged is failed at its next claim',
      () =>
        Effect.gen(function* () {
          yield* atScenarioTime;
          const { row, matches } = yield* freshRow(3);
          const crashing = yield* transport((message) =>
            matches(message) ? Effect.die('crashed after send') : Effect.void,
          );
          for (let claim = 1; claim <= MAX_ATTEMPTS; claim++) {
            yield* Effect.exit(runWith(crashing.service));
            yield* TestClock.adjust(CLAIM_LEASE_MS);
          }
          assert.deepStrictEqual(
            [(yield* rowById(row.id)).status, (yield* rowById(row.id)).attempts],
            ['pending', MAX_ATTEMPTS],
          );
          // The next claim stops it: no further send, attempts within the table's limit.
          yield* runWith(crashing.service);
          const after = yield* rowById(row.id);
          assert.deepStrictEqual([after.status, after.attempts], ['failed', MAX_ATTEMPTS]);
          assert.strictEqual(yield* sentMatching(crashing.sent, matches), MAX_ATTEMPTS);
          // The queue moves on: a later row is still delivered.
          const { row: next } = yield* freshRow(4);
          const healthy = yield* transport();
          yield* runWith(healthy.service);
          assert.strictEqual((yield* rowById(next.id)).status, 'sent');
        }),
    );

    it.effect('a hung send times out well inside its lease and backs off', () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        assert.isBelow(SEND_TIMEOUT_MS * 2, CLAIM_LEASE_MS);
        const { row, matches } = yield* freshRow(5);
        const started = yield* Deferred.make<void>();
        const hanging = yield* transport((message) =>
          matches(message)
            ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.void,
        );
        const fiber = yield* Effect.forkChild(runWith(hanging.service));
        yield* Deferred.await(started);
        yield* Effect.yieldNow;
        const claimedAt = yield* Clock.currentTimeMillis;
        yield* TestClock.adjust(SEND_TIMEOUT_MS);
        yield* Fiber.join(fiber);
        const after = yield* rowById(row.id);
        assert.deepStrictEqual(
          [after.status, after.attempts, after.sendAfter.getTime()],
          ['pending', 1, claimedAt + SEND_TIMEOUT_MS + 2 * MINUTE],
        );
      }),
    );

    it.effect('a sender whose lease ran out cannot touch the row another dispatcher holds', () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        const { row, matches } = yield* freshRow(6);
        const takeoverAt = (yield* Clock.currentTimeMillis) + CLAIM_LEASE_MS + MINUTE;
        const claimed = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const other = yield* transport((message) =>
          matches(message)
            ? Deferred.succeed(claimed, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void,
        );
        const otherRun = yield* Deferred.make<Fiber.Fiber<number, unknown>>();
        // The slow sender is still sending when its lease runs out; a second dispatcher
        // (on a clock past the lease) claims the row and starts sending it. Then the
        // slow send fails.
        const slow = yield* transport((message) =>
          matches(message)
            ? Effect.gen(function* () {
                const fiber = yield* Effect.forkDetach(
                  runWith(other.service).pipe(
                    Effect.provideService(Clock.Clock, fixedClock(takeoverAt)),
                  ),
                );
                yield* Deferred.succeed(otherRun, fiber);
                yield* Deferred.await(claimed);
                return yield* Effect.fail(new NotifyFailed({ reason: 'too slow' }));
              })
            : Effect.void,
        );
        yield* runWith(slow.service);
        // The late failure changed nothing: the row is still the other dispatcher's, leased.
        const during = yield* rowById(row.id);
        assert.deepStrictEqual(
          [during.status, during.attempts, during.sendAfter.getTime()],
          ['pending', 2, takeoverAt + CLAIM_LEASE_MS],
        );
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(yield* Deferred.await(otherRun));
        const after = yield* rowById(row.id);
        assert.deepStrictEqual(
          [after.status, after.attempts, after.sentAt?.getTime()],
          ['sent', 2, takeoverAt],
        );
        assert.strictEqual(yield* sentMatching(slow.sent, matches), 1);
        assert.strictEqual(yield* sentMatching(other.sent, matches), 1);
      }),
    );
  },
);
