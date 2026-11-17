import {
  ActivityId,
  CreditId,
  InteractionId,
  ObservationId,
  PersonId,
  ReportingLineId,
  SkillId,
  SkillIndicatorId,
  SkillVersionId,
  TenantId,
  type IsoDate,
} from '@repo/domain';
import { assert, layer } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { Db, schema } from './index.ts';
import { layerTestDb } from './testing.ts';

/**
 * Each test proves the DATABASE rejects a violation of a named invariant
 * (docs/testing/invariants.md). These hold even if application code is wrong.
 */
const d = (s: string) => s as IsoDate;

const fixture = Effect.gen(function* () {
  const db = yield* Db;
  const tenantId = TenantId.generate();
  const otherTenantId = TenantId.generate();
  const advisor = PersonId.generate();
  const leader = PersonId.generate();
  const stranger = PersonId.generate();
  const skillId = SkillId.generate();
  const versionId = SkillVersionId.generate();
  const indicatorId = SkillIndicatorId.generate();
  const lineId = ReportingLineId.generate();
  const activityId = ActivityId.generate();
  const interactionId = InteractionId.generate();
  const observationId = ObservationId.generate();
  yield* db.insert(schema.tenant).values([
    { id: tenantId, name: 'A', slug: `a-${tenantId}` },
    { id: otherTenantId, name: 'B', slug: `b-${otherTenantId}` },
  ]);
  yield* db.insert(schema.person).values([
    { id: advisor, tenantId, email: `${advisor}@x.test`, displayName: 'Ada' },
    { id: leader, tenantId, email: `${leader}@x.test`, displayName: 'Leo' },
    { id: stranger, tenantId: otherTenantId, email: `${stranger}@x.test`, displayName: 'Zed' },
  ]);
  yield* db.insert(schema.reportingLine).values({
    id: lineId,
    tenantId,
    managerId: leader,
    reportId: advisor,
    validFrom: d('2026-01-01'),
  });
  yield* db.insert(schema.skill).values({
    id: skillId,
    tenantId,
    slug: 'discovery',
    name: 'Discovery',
    summary: 's',
    domain: 'client_discovery',
    outcome: 'trust',
    status: 'published',
  });
  yield* db
    .insert(schema.skillVersion)
    .values({ id: versionId, tenantId, skillId, number: 1, publishedAt: new Date() });
  yield* db
    .insert(schema.skillLevel)
    .values({ tenantId, skillVersionId: versionId, level: 3, summary: 'Independent' });
  yield* db.insert(schema.skillIndicator).values({
    id: indicatorId,
    tenantId,
    skillVersionId: versionId,
    level: 3,
    lineageKey: 'l3-asks',
    text: 'Asks open questions',
    position: 0,
  });
  yield* db.insert(schema.activity).values({
    id: activityId,
    tenantId,
    ownerId: advisor,
    title: 'Review',
    origin: 'ad_hoc',
    status: 'underway',
  });
  yield* db.insert(schema.interaction).values({
    id: interactionId,
    tenantId,
    activityId,
    ownerId: advisor,
    loggedById: advisor,
    occurredOn: d('2026-06-01'),
    kind: 'client_meeting',
  });
  yield* db.insert(schema.observation).values({
    id: observationId,
    tenantId,
    interactionId,
    subjectId: advisor,
    observerId: leader,
    requestedById: advisor,
    basis: 'leader',
    basisReportingLineId: lineId,
    mode: 'saw_it',
    status: 'drafting',
    dueAt: new Date(),
  });
  yield* db
    .insert(schema.observationRating)
    .values({ tenantId, observationId, skillId, skillVersionId: versionId, level: 3 });
  const credit = {
    id: CreditId.generate(),
    tenantId,
    personId: advisor,
    skillId,
    observationId,
    interactionId,
    observerId: leader,
    skillVersionId: versionId,
    level: 3,
    mode: 'saw_it',
    isFirstHand: true,
    demonstratedOn: d('2026-06-01'),
    policyVersion: 'test',
  };
  return {
    tenantId,
    otherTenantId,
    advisor,
    leader,
    stranger,
    skillId,
    versionId,
    indicatorId,
    lineId,
    interactionId,
    observationId,
    credit,
  };
});

const sign = (observationId: ObservationId) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db
      .update(schema.observation)
      .set({
        status: 'signed',
        signedAt: new Date(),
        narrativeSaw: 'Saw it',
        contentDigest: 'digest',
      })
      .where(eq(schema.observation.id, observationId));
  });

const rejected = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => false),
    Effect.catch(() => Effect.succeed(true)),
  );

layer(layerTestDb)('database integrity', (it) => {
  it.effect('I3: the credit ledger and audit trail are append-only', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const f = yield* fixture;
      yield* sign(f.observationId);
      yield* db.insert(schema.creditEntry).values(f.credit);
      assert.isTrue(
        yield* rejected(
          db
            .update(schema.creditEntry)
            .set({ level: 4 })
            .where(eq(schema.creditEntry.id, f.credit.id)),
        ),
      );
      assert.isTrue(
        yield* rejected(
          db.delete(schema.creditEntry).where(eq(schema.creditEntry.id, f.credit.id)),
        ),
      );
    }),
  );

  it.effect('I2: credit exists only for a signed observation, at the rated level', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const f = yield* fixture;
      // Unsigned (still drafting): refused even though every key lines up.
      assert.isTrue(yield* rejected(db.insert(schema.creditEntry).values(f.credit)));
      yield* sign(f.observationId);
      // Signed, but at a level the observer did not give: refused.
      assert.isTrue(
        yield* rejected(db.insert(schema.creditEntry).values({ ...f.credit, level: 4 })),
      );
      yield* db.insert(schema.creditEntry).values(f.credit);
    }),
  );

  it.effect('I2/I4: a credit cannot disagree with the observation that created it', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const f = yield* fixture;
      yield* sign(f.observationId);
      // Wrong observer, wrong person, wrong date: each must be refused by FK.
      assert.isTrue(
        yield* rejected(
          db
            .insert(schema.creditEntry)
            .values({ ...f.credit, observerId: f.advisor, personId: f.leader }),
        ),
      );
      assert.isTrue(
        yield* rejected(
          db.insert(schema.creditEntry).values({ ...f.credit, demonstratedOn: d('2026-06-02') }),
        ),
      );
      assert.isTrue(
        yield* rejected(db.insert(schema.creditEntry).values({ ...f.credit, mode: 'discussed' })),
      );
    }),
  );

  it.effect('a signed observation’s ratings and attestation are frozen', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const f = yield* fixture;
      yield* sign(f.observationId);
      assert.isTrue(
        yield* rejected(
          db
            .update(schema.observationRating)
            .set({ level: 4 })
            .where(eq(schema.observationRating.observationId, f.observationId)),
        ),
      );
      assert.isTrue(
        yield* rejected(
          db
            .update(schema.observation)
            .set({ mode: 'discussed' })
            .where(eq(schema.observation.id, f.observationId)),
        ),
      );
      assert.isTrue(
        yield* rejected(
          db
            .update(schema.observation)
            .set({ status: 'drafting' })
            .where(eq(schema.observation.id, f.observationId)),
        ),
      );
    }),
  );

  it.effect('the eligibility basis must be an edge between exactly these two people', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const f = yield* fixture;
      const swapped = db.insert(schema.observation).values({
        id: ObservationId.generate(),
        tenantId: f.tenantId,
        interactionId: f.interactionId,
        subjectId: f.advisor,
        observerId: f.advisor,
        requestedById: f.advisor,
        basis: 'leader',
        basisReportingLineId: f.lineId,
        mode: 'saw_it',
        status: 'requested',
        dueAt: new Date(),
      });
      assert.isTrue(yield* rejected(swapped));
    }),
  );

  it.effect('tenancy is structural: cross-tenant references are impossible', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const f = yield* fixture;
      assert.isTrue(
        yield* rejected(
          db.insert(schema.reportingLine).values({
            id: ReportingLineId.generate(),
            tenantId: f.tenantId,
            managerId: f.stranger,
            reportId: f.advisor,
            validFrom: d('2027-01-01'),
          }),
        ),
      );
    }),
  );

  it.effect('reporting lines for one person never overlap', () =>
    Effect.gen(function* () {
      const db = yield* Db;
      const f = yield* fixture;
      const second = db.insert(schema.reportingLine).values({
        id: ReportingLineId.generate(),
        tenantId: f.tenantId,
        managerId: f.advisor,
        reportId: f.leader,
        validFrom: d('2026-01-01'),
      });
      assert.isFalse(yield* rejected(second));
      const overlap = db.insert(schema.reportingLine).values({
        id: ReportingLineId.generate(),
        tenantId: f.tenantId,
        managerId: f.leader,
        reportId: f.advisor,
        validFrom: d('2026-03-01'),
        validTo: d('2026-04-01'),
      });
      assert.isTrue(yield* rejected(overlap));
    }),
  );
});
