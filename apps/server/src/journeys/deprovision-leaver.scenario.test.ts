import { Api } from '@repo/api';
import { OPEN_OBSERVATION_STATES, SessionId, type ObservationMode } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, SCENARIO_NOW, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: a leader leaves the firm and a tenant admin deprovisions them
 * (docs/runbooks/deprovisioning.md). Protects I30: in one audited transaction
 * their sessions are gone, every open edge and grant is closed, requests
 * waiting on them are released so the requester can ask someone else, their
 * reports are returned as `manager_departed` findings, and their signed
 * history and credit are untouched.
 */
const client = HttpApiTest.groups(Api, ['directory', 'observations', 'session']);

layer(ScenarioLayer, { timeout: 60_000 })('deprovision a leaver', (it) => {
  it.effect('I30: a departed leader loses access at once and nobody is left waiting on them', () =>
    Effect.gen(function* () {
      yield* atScenarioTime;
      yield* seedWorld;
      const api = yield* client;
      const db = yield* Db;
      const leo = yield* signInAs('Leo Okonkwo');
      const maya = yield* signInAs('Maya Chen');
      const [person] = yield* db.select().from(schema.person).where(eq(schema.person.id, leo));
      assert.isDefined(person);
      const tenantId = person.tenantId;

      // A live session, as a browser sign-in would have left it.
      yield* db.insert(schema.session).values({
        id: SessionId.generate(),
        tenantId,
        personId: leo,
        tokenHash: 'leo-session-hash',
        method: 'dev',
        lastSeenAt: new Date(SCENARIO_NOW),
        expiresAt: new Date(SCENARIO_NOW + 86_400_000),
      });
      const waiting = yield* db
        .select()
        .from(schema.observation)
        .where(
          and(
            eq(schema.observation.observerId, leo),
            inArray(schema.observation.status, [...OPEN_OBSERVATION_STATES]),
          ),
        );
      assert.isAbove(waiting.length, 0, 'the seed has a request waiting on Leo');
      const history = yield* db
        .select({ id: schema.observation.id, status: schema.observation.status })
        .from(schema.observation)
        .where(
          and(
            eq(schema.observation.observerId, leo),
            inArray(schema.observation.status, ['signed', 'under_review']),
          ),
        );
      assert.isAbove(history.length, 0, 'Leo has signed history');
      const creditsBefore = yield* db
        .select({ id: schema.creditEntry.id })
        .from(schema.creditEntry)
        .where(eq(schema.creditEntry.tenantId, tenantId));
      const reversalsBefore = yield* db.select().from(schema.creditReversal);

      // A coach cannot deprovision anyone; the tenant admin can.
      yield* signInAs('Sam Rivera');
      const refused = yield* api.directory
        .departPerson({ params: { id: leo }, payload: {} })
        .pipe(Effect.flip);
      assert.strictEqual(refused._tag, 'Forbidden');

      const rhea = yield* signInAs('Rhea Castillo');
      const result = yield* api.directory.departPerson({ params: { id: leo }, payload: {} });
      assert.strictEqual(result.sessionsEnded, 1);
      assert.strictEqual(result.requestsExpired, waiting.length);
      // Reports to Rhea, leads Maya, Daniel and Aisha.
      assert.strictEqual(result.reportingLinesEnded, 4);
      assert.isAtLeast(result.engagementsEnded, 1);
      assert.sameMembers(
        result.exceptions.map((e) => `${e.kind}:${e.personEmail}`),
        [
          'manager_departed:maya.chen@northwind.example',
          'manager_departed:daniel.okafor@northwind.example',
          'manager_departed:aisha.bello@northwind.example',
        ],
      );
      const again = yield* api.directory
        .departPerson({ params: { id: leo }, payload: {} })
        .pipe(Effect.flip);
      assert.strictEqual(again._tag, 'Conflict');

      // Access ends now: no session rows, no open grants or edges, and the next request is refused.
      const [after] = yield* db.select().from(schema.person).where(eq(schema.person.id, leo));
      assert.strictEqual(after?.status, 'departed');
      const sessions = yield* db
        .select()
        .from(schema.session)
        .where(eq(schema.session.personId, leo));
      assert.lengthOf(sessions, 0);
      const openLines = yield* db
        .select()
        .from(schema.reportingLine)
        .where(
          and(
            isNull(schema.reportingLine.validTo),
            or(eq(schema.reportingLine.managerId, leo), eq(schema.reportingLine.reportId, leo)),
          ),
        );
      assert.lengthOf(openLines, 0);
      const engagements = yield* db
        .select()
        .from(schema.engagement)
        .where(or(eq(schema.engagement.coachId, leo), eq(schema.engagement.coacheeId, leo)));
      assert.isTrue(
        engagements.every((e) => ['ended', 'withdrawn', 'declined', 'expired'].includes(e.status)),
      );
      yield* signInAs('Leo Okonkwo');
      const locked = yield* api.session.me().pipe(Effect.flip);
      assert.strictEqual(locked._tag, 'Unauthorized');

      // Nobody waits on Leo: his requests expired through the lifecycle, audited as a directory change.
      const released = yield* db
        .select()
        .from(schema.observation)
        .where(
          inArray(
            schema.observation.id,
            waiting.map((w) => w.id),
          ),
        );
      assert.isTrue(released.every((o) => o.status === 'expired'));
      const expiries = yield* db
        .select()
        .from(schema.auditEvent)
        .where(
          and(
            inArray(
              schema.auditEvent.entityId,
              waiting.map((w) => w.id),
            ),
            eq(schema.auditEvent.event, 'EXPIRE'),
          ),
        );
      assert.lengthOf(expiries, waiting.length);
      assert.isTrue(
        expiries.every((e) => e.actorId === rhea && e.reasonCode === 'directory_change'),
      );
      const pending = yield* db
        .select()
        .from(schema.notification)
        .where(
          and(eq(schema.notification.recipientId, leo), eq(schema.notification.status, 'pending')),
        );
      assert.lengthOf(pending, 0);

      // Maya asks her coach instead, on the same piece of work.
      const mine = released.find((o) => o.subjectId === maya);
      assert.isDefined(mine);
      const ratings = yield* db
        .select({ skillId: schema.observationRating.skillId })
        .from(schema.observationRating)
        .where(eq(schema.observationRating.observationId, mine.id));
      yield* signInAs('Maya Chen');
      const sam = (yield* db
        .select({ id: schema.person.id })
        .from(schema.person)
        .where(eq(schema.person.displayName, 'Sam Rivera')))[0]?.id;
      assert.isDefined(sam);
      const reRequested = yield* api.observations.request({
        payload: {
          interactionId: mine.interactionId,
          observerId: sam,
          mode: mine.mode as ObservationMode,
          skillIds: ratings.map((r) => r.skillId),
          note: null,
        },
      });
      assert.strictEqual(reRequested.status, 'requested');

      // History intact: signed observations still signed, no credit added or reversed.
      const historyAfter = yield* db
        .select({ id: schema.observation.id, status: schema.observation.status })
        .from(schema.observation)
        .where(
          inArray(
            schema.observation.id,
            history.map((h) => h.id),
          ),
        );
      assert.sameDeepMembers(historyAfter, history);
      const creditsAfter = yield* db
        .select({ id: schema.creditEntry.id })
        .from(schema.creditEntry)
        .where(eq(schema.creditEntry.tenantId, tenantId));
      assert.sameMembers(
        creditsAfter.map((c) => c.id),
        creditsBefore.map((c) => c.id),
      );
      const reversals = yield* db.select().from(schema.creditReversal);
      assert.lengthOf(reversals, reversalsBefore.length);

      const departEvents = yield* db
        .select()
        .from(schema.auditEvent)
        .where(and(eq(schema.auditEvent.entityId, leo), eq(schema.auditEvent.event, 'DEPART')));
      assert.lengthOf(departEvents, 1);
    }),
  );
});
