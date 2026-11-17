import {
  Conflict,
  CurrentActor,
  NotFound,
  Unprocessable,
  type Actor,
  type DepartInput,
  type DepartureResult,
} from '@repo/api';
import {
  ConversationLifecycle,
  EngagementLifecycle,
  OPEN_OBSERVATION_STATES,
  ObservationLifecycle,
  type ConversationStatus,
  type EngagementStatus,
  type IsoDate,
  type ObservationStatus,
  type PersonId,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDaysIso, now, today } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { decide, requireUpdated } from '../shared/mutation.ts';
import { persistFindings, requireTenantAdmin } from './exceptions.ts';
import { finding, toFindingView, type Finding } from './findings.ts';

/** How far back a leaving date may be recorded. A departure never takes effect ahead of today. */
export const MAX_DEPARTURE_BACKDATE_DAYS = 30;

/**
 * Who may close a leaver's open work on their behalf: the tenant admin who is
 * deprovisioning them. Used as the policy half of every `decide()` below.
 */
const departurePolicy = (actor: Actor) => actor.grants.includes('tenant_admin');

/** A dated row that started before the leaving date ends on it; one that had not started is removed. */
const endsOn = (validFrom: IsoDate, effectiveOn: IsoDate) => validFrom < effectiveOn;

interface Leaving {
  readonly actor: Actor;
  readonly personId: PersonId;
  readonly personEmail: string;
  readonly effectiveOn: IsoDate;
  readonly at: Date;
  readonly audit: (event: Parameters<typeof recordAudit>[1]) => ReturnType<typeof recordAudit>;
}

/** An engagement ends on the leaving date, or on its acceptance date if that is later. */
const endedOnFor = (acceptedOn: IsoDate | null, effectiveOn: IsoDate): IsoDate =>
  acceptedOn !== null && acceptedOn > effectiveOn ? acceptedOn : effectiveOn;

export interface Departure {
  readonly counts: Omit<DepartureResult, 'personId' | 'effectiveOn' | 'exceptions'>;
  readonly findings: ReadonlyArray<Finding>;
}

/**
 * Deprovisions a leaver inside the caller's transaction (runbook
 * docs/runbooks/deprovisioning.md, now audited): marks them departed, ends
 * their sessions, dated edges and engagements, releases anyone waiting on them,
 * and records reports left without a manager as exceptions. Signed history,
 * credit, badges and audit rows are never touched (ADR 0007).
 */
/** Reporting lines (as report and as manager), grants and the open position end on the leaving date. */
const endDatedRows = Effect.fn('directory.depart.datedRows')(function* (leaving: Leaving) {
  const { personEmail } = leaving;
  const { actor, personId, effectiveOn, at, audit } = leaving;
  const tenantId = actor.tenantId;
  const db = yield* Db;
  // Reporting lines, as report and as manager.
  const lines = yield* db
    .select()
    .from(schema.reportingLine)
    .where(
      and(
        eq(schema.reportingLine.tenantId, tenantId),
        isNull(schema.reportingLine.validTo),
        or(
          eq(schema.reportingLine.managerId, personId),
          eq(schema.reportingLine.reportId, personId),
        ),
      ),
    );
  const findings: Array<Finding> = [];
  for (const line of lines) {
    if (endsOn(line.validFrom, effectiveOn)) {
      yield* db
        .update(schema.reportingLine)
        .set({ validTo: effectiveOn, syncedAt: at })
        .where(eq(schema.reportingLine.id, line.id));
    } else {
      yield* db.delete(schema.reportingLine).where(eq(schema.reportingLine.id, line.id));
    }
    yield* audit({
      entityType: 'reporting_line',
      entityId: line.id,
      event: 'END',
      data: { managerId: line.managerId, reportId: line.reportId },
    });
    if (line.managerId === personId) {
      const [report] = yield* db
        .select({ email: schema.person.email, status: schema.person.status })
        .from(schema.person)
        .where(and(eq(schema.person.tenantId, tenantId), eq(schema.person.id, line.reportId)));
      if (report && report.status !== 'departed') {
        findings.push(
          finding(
            'manager_departed',
            { email: report.email.toLowerCase(), personId: line.reportId },
            { managerEmail: personEmail },
          ),
        );
      }
    }
  }

  const grants = yield* db
    .select()
    .from(schema.roleGrant)
    .where(
      and(
        eq(schema.roleGrant.tenantId, tenantId),
        eq(schema.roleGrant.personId, personId),
        isNull(schema.roleGrant.validTo),
      ),
    );
  for (const grant of grants) {
    if (endsOn(grant.validFrom, effectiveOn)) {
      yield* db
        .update(schema.roleGrant)
        .set({ validTo: effectiveOn })
        .where(eq(schema.roleGrant.id, grant.id));
    } else {
      yield* db.delete(schema.roleGrant).where(eq(schema.roleGrant.id, grant.id));
    }
    yield* audit({
      entityType: 'role_grant',
      entityId: grant.id,
      event: 'END',
      data: { role: grant.role },
    });
  }

  const positions = yield* db
    .select()
    .from(schema.personPosition)
    .where(
      and(
        eq(schema.personPosition.tenantId, tenantId),
        eq(schema.personPosition.personId, personId),
        isNull(schema.personPosition.validTo),
      ),
    );
  for (const position of positions) {
    if (endsOn(position.validFrom, effectiveOn)) {
      yield* db
        .update(schema.personPosition)
        .set({ validTo: effectiveOn })
        .where(eq(schema.personPosition.id, position.id));
    } else {
      yield* db.delete(schema.personPosition).where(eq(schema.personPosition.id, position.id));
    }
    yield* audit({ entityType: 'person_position', entityId: position.id, event: 'END' });
  }
  return { lines: lines.length, grants: grants.length, positions: positions.length, findings };
});

/** Coaching engagements and designations involving the leaver stop. */
const endRelationships = Effect.fn('directory.depart.relationships')(function* (leaving: Leaving) {
  const { actor, personId, effectiveOn, at, audit } = leaving;
  const tenantId = actor.tenantId;
  const db = yield* Db;
  // Engagements end (or a proposal is withdrawn) through the lifecycle.
  const engagements = yield* db
    .select()
    .from(schema.engagement)
    .where(
      and(
        eq(schema.engagement.tenantId, tenantId),
        inArray(schema.engagement.status, ['proposed', 'active', 'paused']),
        or(eq(schema.engagement.coachId, personId), eq(schema.engagement.coacheeId, personId)),
      ),
    );
  for (const row of engagements) {
    const from = row.status as EngagementStatus;
    const type = from === 'proposed' ? 'WITHDRAW' : 'END';
    const to = yield* decide({
      lifecycle: EngagementLifecycle,
      from,
      facts: { coachGrantActive: true },
      event: { type },
      permitted: departurePolicy(actor),
    });
    const endedOn = to === 'ended' ? endedOnFor(row.acceptedOn, effectiveOn) : null;
    yield* db
      .update(schema.engagement)
      .set({ status: to, endedOn, version: row.version + 1, updatedAt: at })
      .where(and(eq(schema.engagement.id, row.id), eq(schema.engagement.version, row.version)))
      .returning({ id: schema.engagement.id })
      .pipe(Effect.flatMap(requireUpdated('engagement')));
    yield* audit({ entityType: 'engagement', entityId: row.id, event: type, from, to });
  }

  // Designations where they observe or are observed stop on the leaving date.
  const designations = yield* db
    .select()
    .from(schema.observerDesignation)
    .where(
      and(
        eq(schema.observerDesignation.tenantId, tenantId),
        isNull(schema.observerDesignation.endedOn),
        gt(schema.observerDesignation.validTo, effectiveOn),
        or(
          eq(schema.observerDesignation.observerId, personId),
          eq(schema.observerDesignation.subjectId, personId),
        ),
      ),
    );
  for (const row of designations) {
    const endedOn = row.validFrom > effectiveOn ? row.validFrom : effectiveOn;
    yield* db
      .update(schema.observerDesignation)
      .set({ endedOn })
      .where(eq(schema.observerDesignation.id, row.id));
    yield* audit({
      entityType: 'observer_designation',
      entityId: row.id,
      event: 'END',
      from: 'active',
      to: 'ended',
    });
  }
  return { engagements: engagements.length, designations: designations.length };
});

/** Nobody is left waiting on the leaver: requests, conversations and their outbox. */
const releaseWaiting = Effect.fn('directory.depart.waiting')(function* (leaving: Leaving) {
  const { actor, personId, at, audit } = leaving;
  const tenantId = actor.tenantId;
  const db = yield* Db;
  // Requests waiting on the leaver as observer expire, so the requester can ask someone else.
  const requests = yield* db
    .select()
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.tenantId, tenantId),
        eq(schema.observation.observerId, personId),
        inArray(schema.observation.status, [...OPEN_OBSERVATION_STATES]),
      ),
    );
  for (const row of requests) {
    const from = row.status as ObservationStatus;
    const to = yield* decide({
      lifecycle: ObservationLifecycle,
      from,
      facts: {
        ratingsComplete: false,
        narrativeLength: 0,
        privacyHold: false,
        acknowledged: false,
      },
      event: { type: 'EXPIRE' },
      permitted: departurePolicy(actor),
    });
    yield* db
      .update(schema.observation)
      .set({ status: to, version: row.version + 1, updatedAt: at })
      .where(and(eq(schema.observation.id, row.id), eq(schema.observation.version, row.version)))
      .returning({ id: schema.observation.id })
      .pipe(Effect.flatMap(requireUpdated('observation')));
    yield* audit({ entityType: 'observation', entityId: row.id, event: 'EXPIRE', from, to });
  }

  const conversations = yield* db
    .select()
    .from(schema.coachingConversation)
    .where(
      and(
        eq(schema.coachingConversation.tenantId, tenantId),
        eq(schema.coachingConversation.status, 'scheduled'),
        or(
          eq(schema.coachingConversation.hostId, personId),
          eq(schema.coachingConversation.coacheeId, personId),
        ),
      ),
    );
  for (const row of conversations) {
    const from = row.status as ConversationStatus;
    const to = yield* decide({
      lifecycle: ConversationLifecycle,
      from,
      facts: { started: false },
      event: { type: 'CANCEL' },
      permitted: departurePolicy(actor),
    });
    yield* db
      .update(schema.coachingConversation)
      .set({ status: to, closedAt: at, version: row.version + 1, updatedAt: at })
      .where(
        and(
          eq(schema.coachingConversation.id, row.id),
          eq(schema.coachingConversation.version, row.version),
        ),
      )
      .returning({ id: schema.coachingConversation.id })
      .pipe(Effect.flatMap(requireUpdated('conversation')));
    yield* audit({ entityType: 'conversation', entityId: row.id, event: 'CANCEL', from, to });
  }

  const notifications = yield* db
    .update(schema.notification)
    .set({ status: 'skipped' })
    .where(
      and(
        eq(schema.notification.tenantId, tenantId),
        eq(schema.notification.recipientId, personId),
        eq(schema.notification.status, 'pending'),
      ),
    )
    .returning({ id: schema.notification.id });
  return {
    requests: requests.length,
    conversations: conversations.length,
    notifications: notifications.length,
  };
});

export const departWithin = Effect.fn('directory.depart')(function* (
  actor: Actor,
  personId: PersonId,
  effectiveOn: IsoDate,
  source: 'admin' | 'import',
) {
  const db = yield* Db;
  const at = yield* now;
  const tenantId = actor.tenantId;
  const audit: Leaving['audit'] = (event) =>
    recordAudit(actor, {
      reasonCode: 'directory_change',
      ...event,
      data: { departedPersonId: personId, effectiveOn, ...event.data },
    });

  const [person] = yield* db
    .update(schema.person)
    .set({ status: 'departed', updatedAt: at })
    .where(
      and(
        eq(schema.person.tenantId, tenantId),
        eq(schema.person.id, personId),
        ne(schema.person.status, 'departed'),
      ),
    )
    .returning();
  if (!person) {
    return yield* Effect.fail(new Conflict({ message: 'This person has already departed.' }));
  }
  yield* audit({
    entityType: 'person',
    entityId: personId,
    event: 'DEPART',
    to: 'departed',
    data: { source },
  });

  const sessions = yield* db
    .delete(schema.session)
    .where(and(eq(schema.session.tenantId, tenantId), eq(schema.session.personId, personId)))
    .returning({ id: schema.session.id });
  if (sessions.length > 0) {
    yield* audit({
      entityType: 'person',
      entityId: personId,
      event: 'END_SESSIONS',
      data: { sessions: sessions.length },
    });
  }

  const leaving: Leaving = {
    actor,
    personId,
    personEmail: person.email.toLowerCase(),
    effectiveOn,
    at,
    audit,
  };
  const dated = yield* endDatedRows(leaving);
  const relationships = yield* endRelationships(leaving);
  const waiting = yield* releaseWaiting(leaving);
  return {
    counts: {
      sessionsEnded: sessions.length,
      reportingLinesEnded: dated.lines,
      grantsEnded: dated.grants,
      positionsEnded: dated.positions,
      engagementsEnded: relationships.engagements,
      designationsEnded: relationships.designations,
      requestsExpired: waiting.requests,
      conversationsCancelled: waiting.conversations,
      notificationsSkipped: waiting.notifications,
    },
    findings: dated.findings,
  } satisfies Departure;
});

/** `POST /admin/people/:id/depart`: deprovision one leaver now, in one transaction. */
export const departPerson = Effect.fn('useCase.departPerson')(function* (
  personId: PersonId,
  input: DepartInput,
) {
  const actor = yield* CurrentActor;
  yield* requireTenantAdmin(actor, 'Only tenant admins can deprovision a leaver.');
  const db = yield* Db;
  const on = yield* today;
  const effectiveOn = input.effectiveOn ?? on;
  if (effectiveOn > on || effectiveOn < addDaysIso(on, -MAX_DEPARTURE_BACKDATE_DAYS)) {
    return yield* Effect.fail(
      new Unprocessable({
        message: `The leaving date must be today or within the last ${MAX_DEPARTURE_BACKDATE_DAYS} days.`,
        field: 'effectiveOn',
      }),
    );
  }
  if (personId === actor.personId) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'You cannot depart yourself; ask another tenant admin.' }),
    );
  }
  const [person] = yield* db
    .select({ id: schema.person.id, status: schema.person.status })
    .from(schema.person)
    .where(and(eq(schema.person.tenantId, actor.tenantId), eq(schema.person.id, personId)));
  if (!person) return yield* Effect.fail(new NotFound({ entity: 'person', id: personId }));
  if (person.status === 'departed') {
    return yield* Effect.fail(new Conflict({ message: 'This person has already departed.' }));
  }
  const departure = yield* transactionally(
    Effect.gen(function* () {
      const result = yield* departWithin(actor, personId, effectiveOn, 'admin');
      yield* persistFindings(actor, result.findings, on);
      return result;
    }),
  );
  return {
    personId,
    effectiveOn,
    ...departure.counts,
    exceptions: departure.findings.map(toFindingView),
  } satisfies DepartureResult;
});
