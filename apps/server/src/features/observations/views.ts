import type {
  Actor,
  AdvisoryView,
  InboxItem,
  ObservationEventType,
  ObservationView,
  ObserveTarget,
  ObserveTargets,
  WorkSkill,
} from '@repo/api';
import {
  EvidenceLifecycle,
  LEVEL_NAMES,
  MIN_NARRATIVE_LENGTH,
  OBSERVE_WINDOW_DAYS,
  OPEN_OBSERVATION_STATES,
  ObservationLifecycle,
  canReadNarrative,
  developmentAccess,
  isEvidenceHeld,
  resolveCreditValue,
  type ActivityId,
  type EvidenceStatus,
  type InteractionKind,
  type IsoDate,
  type Level,
  type ObservationId,
  type ObservationMode,
  type ObservationStatus,
  type ObserverBasis,
  type PersonId,
  type PointsSource,
  type QuestionSetId,
  type SkillId,
  type SkillRole,
  type CreditRole,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDaysIso, today } from '../../platform/time.ts';
import type { Interpretation } from '../shared/advisory/question-sets.ts';
import { loadActivitySkillRows, loadDefinitions, loadPlanSkills } from '../shared/catalog-reads.ts';
import { observableBy } from '../shared/directory.ts';
import { recordAudit } from '../shared/audit.ts';
import { latestNotes } from '../shared/notes.ts';
import { loadPeople, personFrom } from '../shared/people.ts';
import { tenantCreditPolicy } from '../shared/recognition.ts';
import { loadRelationshipFacts } from '../shared/relationships.ts';
import { loadSkills, refsFor, toSkillRef } from '../shared/skills.ts';
import { currentPlanOf } from '../shared/plans.ts';

type ObservationRow = typeof schema.observation.$inferSelect;

/** Separation of duties (independent review): only compliance voids, upholds or reads narratives. */
const isCompliance = (actor: Actor) => actor.grants.includes('compliance_reviewer');

export const isAdmin = (actor: Actor) =>
  actor.grants.includes('tenant_admin') || actor.grants.includes('compliance_reviewer');

/** Events each party may send (policy); the lifecycle then decides which apply now. */
export const permittedEvents = (
  actor: Actor,
  row: ObservationRow,
): ReadonlyArray<ObservationEventType> => {
  const events: Array<ObservationEventType> = [];
  // An observer who started "I saw this" themselves has nobody to return it to
  // or decline: they finish it or withdraw it. The subject did not ask for it.
  const observerStarted = row.requestedById === row.observerId;
  if (row.observerId === actor.personId) {
    events.push('START', 'SAVE_DRAFT', 'SIGN');
    if (!observerStarted) events.push('RETURN', 'DECLINE');
  }
  if (row.requestedById === actor.personId) events.push('WITHDRAW', 'RESUBMIT');
  if (row.subjectId === actor.personId) events.push('ACKNOWLEDGE', 'REQUEST_REVIEW');
  if (isCompliance(actor) && row.subjectId !== actor.personId) events.push('UPHOLD', 'VOID');
  return events;
};

const toAdvisoryView = (row: typeof schema.advisoryCheck.$inferSelect): AdvisoryView => {
  const result = (row.result ?? null) as Interpretation | null;
  return {
    id: row.id,
    questionSet: row.questionSet as QuestionSetId,
    status: row.status as AdvisoryView['status'],
    effect: row.effect ?? null,
    findings: result?.findings ? [...result.findings] : [],
    provider: row.provider,
  };
};

/** Latest check per question set for the given subjects. */
const visibleChecks = Effect.fn('observations.checks')(function* (
  tenantId: TenantId,
  subjects: ReadonlyArray<{ type: string; id: string }>,
) {
  const db = yield* Db;
  if (subjects.length === 0) return [];
  const rows = yield* db
    .select()
    .from(schema.advisoryCheck)
    .where(
      and(
        eq(schema.advisoryCheck.tenantId, tenantId),
        inArray(
          schema.advisoryCheck.subjectId,
          subjects.map((s) => s.id),
        ),
      ),
    )
    .orderBy(desc(schema.advisoryCheck.createdAt));
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.subjectId}:${row.questionSet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

export const loadObservation = Effect.fn('observations.load')(function* (
  actor: Actor,
  id: ObservationId,
) {
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(schema.observation)
    .where(and(eq(schema.observation.tenantId, actor.tenantId), eq(schema.observation.id, id)));
  return row;
});

/** Visible to observer, subject, requester, the subject's development viewers, and admins. */
export const canSeeObservation = Effect.fn('observations.canSee')(function* (
  actor: Actor,
  row: ObservationRow,
) {
  if ([row.observerId, row.subjectId, row.requestedById].includes(actor.personId) || isAdmin(actor))
    return true;
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  return (
    developmentAccess(facts, {
      viewerId: actor.personId,
      subjectId: row.subjectId,
      on: yield* today,
    }) !== 'none'
  );
});

const viewerRoleOf = (actor: Actor, row: ObservationRow): ObservationView['viewerRole'] => {
  if (row.observerId === actor.personId) return 'observer';
  if (row.subjectId === actor.personId) return 'subject';
  return 'viewer';
};

/** Everything an observation view reads: the work, its evidence, ratings, credits and people. */
const loadObservationParts = Effect.fn('observations.viewParts')(function* (
  actor: Actor,
  row: ObservationRow,
) {
  const db = yield* Db;
  const [interaction] = yield* db
    .select()
    .from(schema.interaction)
    .where(eq(schema.interaction.id, row.interactionId));
  if (!interaction) return yield* Effect.die('invariant: observation without interaction');
  const [activity] = yield* db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.id, interaction.activityId));
  const [evidence] = yield* db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.interactionId, interaction.id))
    .orderBy(desc(schema.evidence.createdAt))
    .limit(1);
  const ratings = yield* db
    .select()
    .from(schema.observationRating)
    .where(eq(schema.observationRating.observationId, row.id))
    .orderBy(schema.observationRating.position);
  const ticks = yield* db
    .select()
    .from(schema.observationIndicator)
    .where(eq(schema.observationIndicator.observationId, row.id));
  const credits = yield* db
    .select()
    .from(schema.creditEntry)
    .where(eq(schema.creditEntry.observationId, row.id));
  const earnedHere = row.signedAt
    ? yield* db
        .select()
        .from(schema.badgeAward)
        .where(
          and(
            eq(schema.badgeAward.tenantId, actor.tenantId),
            eq(schema.badgeAward.triggeringObservationId, row.id),
            eq(schema.badgeAward.status, 'awarded'),
          ),
        )
    : [];
  const notes = (yield* latestNotes(actor.tenantId, 'observation', [row.id])).get(row.id) ?? {};
  const skillIds = ratings.map((r) => r.skillId);
  const [skills, definitions, facts] = yield* Effect.all([
    loadSkills(actor.tenantId, [...skillIds, ...earnedHere.map((b) => b.skillId)]),
    loadDefinitions(
      actor.tenantId,
      ratings.map((r) => r.skillVersionId),
    ),
    loadRelationshipFacts(actor.tenantId),
  ]);
  const earlierRows = skillIds.length
    ? yield* db
        .select()
        .from(schema.creditEntry)
        .where(
          and(
            eq(schema.creditEntry.tenantId, actor.tenantId),
            eq(schema.creditEntry.personId, row.subjectId),
            inArray(schema.creditEntry.skillId, skillIds),
            ne(schema.creditEntry.observationId, row.id),
          ),
        )
        .orderBy(desc(schema.creditEntry.demonstratedOn))
        .limit(3)
    : [];
  const people = yield* loadPeople(actor.tenantId, [
    row.subjectId,
    row.observerId,
    row.requestedById,
    ...earlierRows.map((e) => e.observerId),
  ]);
  return {
    interaction,
    activity,
    evidence,
    ratings,
    ticks,
    credits,
    earnedHere,
    notes,
    skillIds,
    skills,
    definitions,
    facts,
    earlierRows,
    people,
  };
});

type ObservationParts = Effect.Success<ReturnType<typeof loadObservationParts>>;

/**
 * Ratings and levels; an unsigned draft hides levels and ticks from all but the
 * observer. Roles show to everyone; only the observer of unsigned work may change them.
 */
const ratingViews = (
  { ratings, ticks, skills, definitions }: ObservationParts,
  draftHidden: boolean,
  roleChoosable: boolean,
  valuesOf: (skillId: SkillId) => Readonly<Record<SkillRole, number>> | null,
): ObservationView['ratings'] =>
  ratings.flatMap((r) => {
    const skill = skills.get(r.skillId);
    if (!skill) return [];
    return [
      {
        skill: toSkillRef(skill),
        skillVersionId: r.skillVersionId,
        levels: definitions.get(r.skillVersionId)?.levels ?? [],
        level: draftHidden ? null : ((r.level as Level | null) ?? null),
        indicatorIds: draftHidden
          ? []
          : ticks.filter((t) => t.skillId === r.skillId).map((t) => t.indicatorId),
        credit: r.credit,
        role: r.role as CreditRole,
        roleChoosable,
        values: valuesOf(r.skillId),
      },
    ];
  });

/**
 * For the observer of unsigned work: the tenant's skill limit and what each
 * rated skill would add in each role, resolved as signing resolves it. A
 * preview only; signing resolves again inside its transaction.
 */
const draftValues = Effect.fn('observations.draftValues')(function* (
  actor: Actor,
  parts: ObservationParts,
) {
  const policy = yield* tenantCreditPolicy(actor.tenantId);
  const listed =
    (yield* loadActivitySkillRows(actor.tenantId, [parts.interaction.activityId])).get(
      parts.interaction.activityId,
    ) ?? [];
  const valuesOf = (skillId: SkillId): Readonly<Record<SkillRole, number>> => {
    const row = listed.find((s) => s.skillId === skillId);
    const skill = parts.skills.get(skillId);
    const activity = row
      ? {
          role: row.role as SkillRole,
          pointsOverride: row.pointsOverride,
          templatePoints: row.templatePoints,
        }
      : null;
    return {
      primary: resolveCreditValue({ role: 'primary', policy, activity, skill }).points,
      secondary: resolveCreditValue({ role: 'secondary', policy, activity, skill }).points,
    };
  };
  return { maxSkills: policy.maxSkillsPerObservation, valuesOf };
});

/** What signing produced: credits, badges earned here, and earlier credits for the same skills. */
const outcomeViews = ({
  credits,
  ratings,
  earnedHere,
  earlierRows,
  skills,
  people,
}: ObservationParts) => ({
  // In the order the skills were rated.
  credits: credits
    .toSorted(
      (a, b) =>
        ratings.findIndex((r) => r.skillId === a.skillId) -
        ratings.findIndex((r) => r.skillId === b.skillId),
    )
    .flatMap((c) => {
      const skill = skills.get(c.skillId);
      return skill
        ? [
            {
              skill: toSkillRef(skill),
              level: c.level,
              levelName: LEVEL_NAMES[c.level as Level],
              firstHand: c.isFirstHand,
              points: c.points,
              role: c.role as CreditRole,
              pointsSource: c.pointsSource as PointsSource,
            },
          ]
        : [];
    }),
  badgesEarned: earnedHere.flatMap((b) => {
    const skill = skills.get(b.skillId);
    return skill
      ? [
          {
            id: b.id,
            skill: toSkillRef(skill),
            level: b.level,
            levelName: LEVEL_NAMES[b.level as Level],
          },
        ]
      : [];
  }),
  earlier: earlierRows.flatMap((e) => {
    const skill = skills.get(e.skillId);
    return skill
      ? [
          {
            id: e.observationId,
            observer: personFrom(people, e.observerId),
            occurredOn: e.demonstratedOn,
            skill: toSkillRef(skill),
            level: e.level,
          },
        ]
      : [];
  }),
});

export const buildObservationView = Effect.fn('observations.view')(function* (
  actor: Actor,
  row: ObservationRow,
) {
  const parts = yield* loadObservationParts(actor, row);
  const { interaction, activity, evidence, notes, skillIds, skills, facts, people } = parts;
  const on = yield* today;
  const isObserver = row.observerId === actor.personId;
  // Only the observer of unsigned work may change ratings and roles (design §4).
  const roleChoosable = isObserver && (row.status === 'requested' || row.status === 'drafting');
  const drafting = roleChoosable ? yield* draftValues(actor, parts) : null;
  // An unsigned draft is the observer's alone; nobody else sees its levels or words yet.
  const draftHidden = row.signedAt === null && !isObserver;
  const byRelationship = canReadNarrative(facts, {
    viewerId: actor.personId,
    subjectId: row.subjectId,
    observerId: row.observerId,
    on,
  });
  // Compliance may read narratives outside their relationships; each such read is audited.
  const complianceRead = !byRelationship && isCompliance(actor) && row.signedAt !== null;
  const narrativeVisible = !draftHidden && (byRelationship || complianceRead);
  if (complianceRead) {
    yield* recordAudit(actor, {
      entityType: 'observation',
      entityId: row.id,
      event: 'READ_NARRATIVE',
      data: { basis: 'compliance_reviewer' },
    });
  }
  const checks = yield* visibleChecks(actor.tenantId, [
    { type: 'observation', id: row.id },
    ...(evidence ? [{ type: 'evidence', id: evidence.id }] : []),
  ]);
  const isAuthor = evidence?.authorId === actor.personId;
  const hidden =
    evidence &&
    (evidence.status === 'held' || evidence.status === 'escalated') &&
    !isAuthor &&
    !isAdmin(actor);
  const viewerRole = viewerRoleOf(actor, row);
  // Actions say what the state allows. SIGN appears while drafting even if the
  // draft is incomplete; its minimums are checked on submit with a clear message.
  const evidenceStatus = evidence?.status as EvidenceStatus | undefined;
  const ratingFacts = {
    ratingsComplete: true,
    narrativeLength: MIN_NARRATIVE_LENGTH,
    privacyHold: false,
    acknowledged: row.acknowledgedAt !== null,
    reflectionHeld: isEvidenceHeld(evidenceStatus),
  };
  const candidates = permittedEvents(actor, row)
    .filter((e) => e !== 'SAVE_DRAFT')
    .map((type) => ({ type }));

  return {
    id: row.id,
    status: row.status as ObservationStatus,
    mode: row.mode as ObservationMode,
    basis: row.basis as ObserverBasis,
    subject: personFrom(people, row.subjectId),
    observer: personFrom(people, row.observerId),
    requestedBy: personFrom(people, row.requestedById),
    viewerRole,
    interaction: {
      id: interaction.id,
      occurredOn: interaction.occurredOn,
      kind: interaction.kind as InteractionKind,
      activityTitle: activity?.title ?? 'Work',
      clientRef: interaction.clientRef,
    },
    evidence: evidence
      ? {
          status: evidence.status as EvidenceStatus,
          body: hidden ? null : evidence.body,
          holdReason: evidence.holdReason,
        }
      : null,
    requestNote: notes.request ?? null,
    requestedSkills: refsFor(skills, skillIds),
    ratings: ratingViews(
      parts,
      draftHidden,
      roleChoosable,
      (skillId) => drafting?.valuesOf(skillId) ?? null,
    ),
    narrativeSaw: narrativeVisible ? (row.narrativeSaw ?? '') : '',
    narrativeNext: narrativeVisible ? (row.narrativeNext ?? '') : '',
    returnNote: notes.return ?? null,
    declineReason: notes.decline ?? null,
    dueAt: row.dueAt.toISOString(),
    signedAt: row.signedAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    reviewNote: notes.review ?? null,
    narrativeVisible,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    ...outcomeViews(parts),
    advisory: viewerRole === 'subject' ? [] : checks.map(toAdvisoryView),
    actions: ObservationLifecycle.allowed(row.status as ObservationStatus, ratingFacts, candidates),
    // The returned loop: the requester revises their own reflection, then resends.
    canReviseEvidence:
      row.status === 'returned' &&
      isAuthor &&
      row.requestedById === actor.personId &&
      evidenceStatus !== undefined &&
      EvidenceLifecycle.next(evidenceStatus, {}, { type: 'REVISE' }) !== null,
    maxSkills: drafting?.maxSkills ?? null,
  } satisfies ObservationView;
});

const toInboxItems = Effect.fn('observations.inboxItems')(function* (
  tenantId: TenantId,
  rows: ReadonlyArray<ObservationRow>,
) {
  if (rows.length === 0) return [] as Array<InboxItem>;
  const db = yield* Db;
  const interactionIds = rows.map((r) => r.interactionId);
  const [interactions, ratings, ticks, evidence] = yield* Effect.all([
    db.select().from(schema.interaction).where(inArray(schema.interaction.id, interactionIds)),
    db
      .select()
      .from(schema.observationRating)
      .where(
        inArray(
          schema.observationRating.observationId,
          rows.map((r) => r.id),
        ),
      ),
    db
      .select()
      .from(schema.observationIndicator)
      .where(
        inArray(
          schema.observationIndicator.observationId,
          rows.map((r) => r.id),
        ),
      ),
    db.select().from(schema.evidence).where(inArray(schema.evidence.interactionId, interactionIds)),
  ]);
  const activities = yield* db
    .select({ id: schema.activity.id, title: schema.activity.title })
    .from(schema.activity)
    .where(
      inArray(
        schema.activity.id,
        interactions.map((i) => i.activityId),
      ),
    );
  const people = yield* loadPeople(
    tenantId,
    rows.flatMap((r) => [r.subjectId, r.observerId]),
  );
  const skills = yield* loadSkills(
    tenantId,
    ratings.map((r) => r.skillId),
  );
  return rows.map((row): InboxItem => {
    const interaction = interactions.find((i) => i.id === row.interactionId);
    const ev = evidence.find(
      (e) => e.interactionId === row.interactionId && e.status === 'available',
    );
    return {
      id: row.id,
      status: row.status as ObservationStatus,
      subject: personFrom(people, row.subjectId),
      observer: personFrom(people, row.observerId),
      activityTitle: activities.find((a) => a.id === interaction?.activityId)?.title ?? 'Work',
      occurredOn:
        interaction?.occurredOn ??
        (row.createdAt.toISOString().slice(0, 10) as InboxItem['occurredOn']),
      skills: refsFor(
        skills,
        ratings.filter((r) => r.observationId === row.id).map((r) => r.skillId),
      ),
      evidencePreview: ev?.body ? ev.body.slice(0, 160) : null,
      indicatorsTicked: ticks.filter((t) => t.observationId === row.id).length,
      dueAt: row.dueAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
});

export const buildInbox = Effect.fn('observations.inbox')(function* (actor: Actor) {
  const db = yield* Db;
  const mineAsObserver = yield* db
    .select()
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.tenantId, actor.tenantId),
        eq(schema.observation.observerId, actor.personId),
        inArray(schema.observation.status, ['requested', 'drafting', 'signed', 'under_review']),
      ),
    )
    .orderBy(schema.observation.dueAt);
  const mineAsSubject = yield* db
    .select()
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.tenantId, actor.tenantId),
        eq(schema.observation.subjectId, actor.personId),
        inArray(schema.observation.status, ['requested', 'drafting', 'returned']),
      ),
    )
    .orderBy(schema.observation.dueAt);
  const items = yield* toInboxItems(actor.tenantId, [...mineAsObserver, ...mineAsSubject]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const pick = (rows: ReadonlyArray<ObservationRow>) =>
    rows.flatMap((r) => (byId.has(r.id) ? [byId.get(r.id) as InboxItem] : []));
  return {
    requests: pick(mineAsObserver.filter((r) => r.status === 'requested')),
    drafts: pick(mineAsObserver.filter((r) => r.status === 'drafting')),
    signed: pick(
      mineAsObserver
        .filter((r) => r.status === 'signed' || r.status === 'under_review')
        .toSorted((a, b) => (b.signedAt?.getTime() ?? 0) - (a.signedAt?.getTime() ?? 0))
        .slice(0, 20),
    ),
    mine: pick(mineAsSubject),
  };
});

/** An observer's own observation that is still open or stands signed: they observe that work once. */
export const LIVE_OR_SIGNED = [...OPEN_OBSERVATION_STATES, 'signed', 'under_review'];

/** A work's skills in order with their default roles, primary first. */
const workSkillsOf = (
  rows: ReadonlyArray<{ readonly skillId: SkillId; readonly role: string }>,
  skills: ReadonlyMap<SkillId, Parameters<typeof toSkillRef>[0]>,
): Array<WorkSkill> =>
  rows
    .toSorted((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary'))
    .flatMap((r) => {
      const skill = skills.get(r.skillId);
      return skill ? [{ skill: toSkillRef(skill), role: r.role as SkillRole }] : [];
    });

/**
 * The subject's work inside the "I saw this" window that the actor has not
 * already observed (no open or signed observation of theirs on it), newest
 * first. "I saw this" attaches to one of these instead of recording it again.
 */
const attachableWork = Effect.fn('observations.attachableWork')(function* (
  actor: Actor,
  subjectId: PersonId,
  on: IsoDate,
) {
  const db = yield* Db;
  const interactions = yield* db
    .select()
    .from(schema.interaction)
    .where(
      and(
        eq(schema.interaction.tenantId, actor.tenantId),
        eq(schema.interaction.ownerId, subjectId),
        gte(schema.interaction.occurredOn, addDaysIso(on, -OBSERVE_WINDOW_DAYS)),
        lte(schema.interaction.occurredOn, on),
      ),
    )
    .orderBy(desc(schema.interaction.occurredOn), desc(schema.interaction.createdAt));
  if (interactions.length === 0) return [];
  const mine = yield* db
    .select({ interactionId: schema.observation.interactionId })
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.tenantId, actor.tenantId),
        eq(schema.observation.observerId, actor.personId),
        inArray(
          schema.observation.interactionId,
          interactions.map((i) => i.id),
        ),
        inArray(schema.observation.status, LIVE_OR_SIGNED),
      ),
    );
  const observed = new Set(mine.map((o) => o.interactionId));
  return interactions.filter((i) => !observed.has(i.id));
});

/** People the actor can observe today, with what they are working on and the work they logged. */
export const buildTargets = Effect.fn('observations.targets')(function* (actor: Actor) {
  const facts = yield* loadRelationshipFacts(actor.tenantId);
  const on = yield* today;
  const targets = observableBy(facts, actor.personId, on);
  const db = yield* Db;
  const people = yield* loadPeople(
    actor.tenantId,
    targets.map((t) => t.subjectId),
  );
  const result: Array<ObserveTarget> = [];
  for (const target of targets) {
    const subjectId = target.subjectId as PersonId;
    const plan = yield* currentPlanOf(actor.tenantId, subjectId);
    const activities = plan
      ? yield* db
          .select()
          .from(schema.activity)
          .where(
            and(
              eq(schema.activity.tenantId, actor.tenantId),
              eq(schema.activity.planId, plan.id),
              // Ad-hoc activities hold one captured piece of work; offering them again duplicated chips.
              eq(schema.activity.origin, 'planned'),
              inArray(schema.activity.status, ['planned', 'underway']),
            ),
          )
      : [];
    const work = yield* attachableWork(actor, subjectId, on);
    const workActivities = work.length
      ? yield* db
          .select({ id: schema.activity.id, title: schema.activity.title })
          .from(schema.activity)
          .where(
            and(
              eq(schema.activity.tenantId, actor.tenantId),
              inArray(
                schema.activity.id,
                work.map((w) => w.activityId),
              ),
            ),
          )
      : [];
    const focus = plan
      ? ((yield* loadPlanSkills(actor.tenantId, [plan.id])).get(plan.id) ?? [])
      : [];
    const activitySkills = yield* loadActivitySkillRows(actor.tenantId, [
      ...new Set<ActivityId>([...activities.map((a) => a.id), ...work.map((w) => w.activityId)]),
    ]);
    const skills = yield* loadSkills(actor.tenantId, [
      ...focus.map((f) => f.skillId),
      ...[...activitySkills.values()].flat().map((r) => r.skillId),
    ]);
    result.push({
      person: personFrom(people, subjectId),
      basis: target.basis,
      activities: activities.map((a) => ({
        id: a.id,
        title: a.title,
        skills: workSkillsOf(activitySkills.get(a.id) ?? [], skills),
      })),
      work: work.map((w) => ({
        id: w.id,
        occurredOn: w.occurredOn,
        kind: w.kind as InteractionKind,
        title: workActivities.find((a) => a.id === w.activityId)?.title ?? 'Work',
        activityId: w.activityId,
        skills: workSkillsOf(activitySkills.get(w.activityId) ?? [], skills),
      })),
      focusSkills: refsFor(
        skills,
        focus.map((f) => f.skillId as SkillId),
      ),
    });
  }
  return {
    people: result.toSorted((a, b) => a.person.displayName.localeCompare(b.person.displayName)),
    maxSkills: (yield* tenantCreditPolicy(actor.tenantId)).maxSkillsPerObservation,
  } satisfies ObserveTargets;
});
