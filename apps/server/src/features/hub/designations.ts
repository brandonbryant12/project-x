import {
  Conflict,
  CurrentActor,
  Forbidden,
  NotFound,
  Unprocessable,
  type DesignationView,
} from '@repo/api';
import {
  DESIGNATION_REASON_TEXT,
  DesignationId,
  checkDesignation,
  coachesOf,
  leaderOf,
  type IsoDate,
  type PersonId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { today } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { loadPeople, personFrom } from '../shared/people.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';

type Row = typeof schema.observerDesignation.$inferSelect;

/**
 * Designated observers (ADR 0020). The rule lives in `checkDesignation`; this
 * file loads facts, writes the row and its audit event in one transaction, and
 * shapes views. The integrity migration backs the overlap rule.
 */
const views = Effect.fn('designations.views')(function* (rows: ReadonlyArray<Row>) {
  const actor = yield* CurrentActor;
  const on = yield* today;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const people = yield* loadPeople(
    actor.tenantId,
    rows.flatMap((r) => [r.subjectId, r.observerId, r.designatedById]),
  );
  return rows.map((r): DesignationView => {
    const validTo = (r.endedOn ?? r.validTo) as IsoDate;
    const active = r.validFrom <= on && on < validTo;
    const entitled =
      r.designatedById === actor.personId ||
      leaderOf(facts, r.subjectId, on) === actor.personId ||
      coachesOf(facts, r.subjectId, on).includes(actor.personId);
    return {
      id: r.id,
      subject: personFrom(people, r.subjectId),
      observer: personFrom(people, r.observerId),
      designatedBy: personFrom(people, r.designatedById),
      validFrom: r.validFrom,
      validTo,
      active,
      canEnd: active && r.endedOn === null && entitled,
    };
  });
});

/** Visible to the subject, the designee, and the subject's leader and coaches. */
export const listDesignations = Effect.fn('designations.list')(function* (subjectId: PersonId) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const on = yield* today;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const supports =
    actor.personId === subjectId ||
    leaderOf(facts, subjectId, on) === actor.personId ||
    coachesOf(facts, subjectId, on).includes(actor.personId);
  const rows = yield* db
    .select()
    .from(schema.observerDesignation)
    .where(
      and(
        eq(schema.observerDesignation.tenantId, actor.tenantId),
        eq(schema.observerDesignation.subjectId, subjectId),
        supports ? undefined : eq(schema.observerDesignation.observerId, actor.personId),
      ),
    )
    .orderBy(schema.observerDesignation.validFrom);
  return yield* views(rows);
});

export const designate = Effect.fn('designations.create')(function* (input: {
  readonly subjectId: PersonId;
  readonly observerId: PersonId;
  readonly validFrom: IsoDate;
  readonly validTo: IsoDate;
}) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const on = yield* today;
  if (input.validFrom < on) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'A designation starts today or later.', field: 'validFrom' }),
    );
  }
  const people = yield* loadPeople(actor.tenantId, [input.subjectId, input.observerId]);
  if (people.size < new Set([input.subjectId, input.observerId]).size) {
    return yield* Effect.fail(new NotFound({ entity: 'person', id: input.observerId }));
  }
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const check = checkDesignation(facts, {
    designatorId: actor.personId,
    ...input,
    from: input.validFrom,
    to: input.validTo,
  });
  if (!check.ok) {
    const message = DESIGNATION_REASON_TEXT[check.reason];
    if (check.reason === 'not_leader_or_coach')
      return yield* Effect.fail(new Forbidden({ message }));
    if (check.reason === 'overlaps_existing') return yield* Effect.fail(new Conflict({ message }));
    return yield* Effect.fail(
      new Unprocessable({
        message,
        field: check.reason === 'bad_window' ? 'validTo' : 'observerId',
      }),
    );
  }
  const id = DesignationId.generate();
  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.observerDesignation).values({
        id,
        tenantId: actor.tenantId,
        subjectId: input.subjectId,
        observerId: input.observerId,
        designatedById: actor.personId,
        designatorBasis: check.designatorBasis,
        validFrom: input.validFrom,
        validTo: input.validTo,
      });
      yield* recordAudit(actor, {
        entityType: 'observer_designation',
        entityId: id,
        event: 'DESIGNATE',
        to: 'active',
        data: {
          subjectId: input.subjectId,
          observerId: input.observerId,
          basis: check.designatorBasis,
        },
      });
    }),
  );
  const [row] = yield* db
    .select()
    .from(schema.observerDesignation)
    .where(eq(schema.observerDesignation.id, id));
  const [view] = yield* views(row ? [row] : []);
  if (!view) return yield* Effect.die('invariant: designation view missing');
  return view;
});

export const endDesignation = Effect.fn('designations.end')(function* (id: DesignationId) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const on = yield* today;
  const [row] = yield* db
    .select()
    .from(schema.observerDesignation)
    .where(
      and(
        eq(schema.observerDesignation.tenantId, actor.tenantId),
        eq(schema.observerDesignation.id, id),
      ),
    );
  if (!row) return yield* Effect.fail(new NotFound({ entity: 'designation', id }));
  const [current] = yield* views([row]);
  if (!current?.canEnd) {
    return yield* Effect.fail(
      new Forbidden({
        message: 'Only their leader or coach can end this designation while it is active.',
      }),
    );
  }
  // Ending today means the designee can no longer start or sign from today.
  const endedOn = on > row.validFrom ? on : row.validFrom;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.observerDesignation)
        .set({ endedOn })
        .where(eq(schema.observerDesignation.id, id));
      yield* recordAudit(actor, {
        entityType: 'observer_designation',
        entityId: id,
        event: 'END',
        from: 'active',
        to: 'ended',
      });
    }),
  );
  const [updated] = yield* db
    .select()
    .from(schema.observerDesignation)
    .where(eq(schema.observerDesignation.id, id));
  const [view] = yield* views(updated ? [updated] : []);
  if (!view) return yield* Effect.die('invariant: designation view missing');
  return view;
});
