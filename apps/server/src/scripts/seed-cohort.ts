import type { Actor } from '@repo/api';
import { CurrentActor } from '@repo/api';
import {
  EngagementId,
  PersonId,
  PositionId,
  ReportingLineId,
  RoleGrantId,
  type ActivityId,
  type IsoDate,
  type Level,
  type ObservationMode,
  type PlanId,
  type SkillId,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import {
  addActivity,
  createPlan,
  logInteraction,
  planEvent,
} from '../features/development/use-cases.ts';
import { requestObservation } from '../features/observations/use-cases/create.ts';
import { signObservation } from '../features/observations/use-cases/sign.ts';
import { transitionObservation } from '../features/observations/use-cases/transition.ts';
import { addDaysIso, fixedClock, today } from '../platform/time.ts';
import { runSweeps } from '../scheduler/sweeps.ts';
import { SEED_TEMPLATES } from './seed-catalog.ts';

/**
 * A practice cohort for the adoption view (ADR 0021): three leaders, thirty
 * advisors and a program owner, with twelve weeks of history replayed through
 * the real use cases on the dates it happened. Without it, almost every
 * adoption figure falls under the five-person minimum.
 *
 * Deterministic: a seeded generator decides who logs what and when, so every
 * reset produces the same firm. Only `pnpm db:seed` runs it; scenario tests use
 * the smaller story world.
 */
const FIRST = [
  'Avery',
  'Blake',
  'Carmen',
  'Devon',
  'Elena',
  'Farid',
  'Grace',
  'Hiro',
  'Imani',
  'Jonah',
  'Kira',
  'Luis',
  'Mara',
  'Nikhil',
  'Olivia',
  'Pavel',
  'Quinn',
  'Rosa',
  'Soren',
  'Tessa',
  'Umar',
  'Vera',
  'Wes',
  'Xena',
  'Yusuf',
  'Zoe',
  'Anika',
  'Bruno',
  'Celia',
  'Dmitri',
];
const LAST = [
  'Adler',
  'Brennan',
  'Costa',
  'Dubois',
  'Ellis',
  'Fischer',
  'Garza',
  'Hayes',
  'Ito',
  'Jensen',
  'Kowalski',
  'Lindqvist',
  'Moreau',
  'Nakamura',
  'Okoro',
  'Patel',
  'Quint',
  'Reyes',
  'Silva',
  'Tanaka',
  'Underwood',
  'Varga',
  'Whitfield',
  'Xu',
  'Yilmaz',
  'Zimmer',
  'Abara',
  'Bianchi',
  'Castro',
  'Dahl',
];
const LEADERS = [
  { name: 'Helen Marsh', location: 'Providence' },
  { name: 'Omar Haddad', location: 'Stamford' },
  { name: 'Ruth Calloway', location: 'Portland' },
];
const REFLECTIONS = [
  'Walked through the plan step by step and checked understanding before moving on.',
  'Asked about what a good year looks like for them before talking about the portfolio.',
  'Explained the fee change plainly and paused for questions.',
  'Summarised what I heard and let them correct me before proposing anything.',
  'Agreed a next step and a date before ending the meeting.',
];
const SAW = [
  'Opened with their goals, not the portfolio, and summarised before proposing anything.',
  'Kept the explanation short and checked understanding twice without rushing.',
  'Handled the question about fees directly and wrote down the follow-up.',
  'Let the silence sit after the hard question; the client filled it with what mattered.',
];
const NEXT = [
  'Try ending with one agreed action and a date.',
  'Use one concrete example before the numbers.',
  'Ask what would change their mind before recommending.',
];

/** About two thirds seen, the rest mostly reviewed work, some discussed. */
const modeFor = (a: number, b: number): ObservationMode => {
  if (a < 0.65) return 'saw_it';
  return b < 0.6 ? 'reviewed_work' : 'discussed';
};

/** Mulberry32: a tiny deterministic generator. */
const random = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

export const seedCohort = Effect.gen(function* () {
  const db = yield* Db;
  const on = yield* today;
  const rand = random(20261116);
  const pick = <T>(xs: ReadonlyArray<T>): T => xs[Math.floor(rand() * xs.length)] as T;
  const ago = (days: number) => addDaysIso(on, -days);

  const [tenant] = yield* db.select().from(schema.tenant);
  if (!tenant) return yield* Effect.die('seed: run the story world first');
  const tenantId: TenantId = tenant.id;
  const [existing] = yield* db
    .select()
    .from(schema.person)
    .where(
      and(eq(schema.person.tenantId, tenantId), eq(schema.person.displayName, 'Nadia Brooks')),
    );
  if (existing) return;

  const byName = new Map(
    (yield* db.select().from(schema.person).where(eq(schema.person.tenantId, tenantId))).map(
      (p) => [p.displayName, p.id],
    ),
  );
  const rhea = byName.get('Rhea Castillo') as PersonId;
  const coaches = [byName.get('Sam Rivera'), byName.get('Jordan Blake')] as Array<PersonId>;
  const skills = new Map(
    (yield* db.select().from(schema.skill).where(eq(schema.skill.tenantId, tenantId))).map((s) => [
      s.slug,
      s.id,
    ]),
  );
  const templates = new Map(
    (yield* db
      .select()
      .from(schema.activityTemplate)
      .where(eq(schema.activityTemplate.tenantId, tenantId))).map((t) => [t.slug, t.id]),
  );

  // Directory: HR data, written directly as an import would.
  const start = ago(120);
  const owner = { id: PersonId.generate(), name: 'Nadia Brooks' };
  const leaders = LEADERS.map((l) => ({ ...l, id: PersonId.generate() }));
  const advisors = FIRST.map((first, i) => ({
    id: PersonId.generate(),
    name: `${first} ${LAST[i]}`,
    leader: leaders[i % leaders.length] as (typeof leaders)[number],
    coach: i % 3 === 0 ? (coaches[i % 2] ?? null) : null,
  }));
  const people = [
    { id: owner.id, name: owner.name, title: 'Head of Advisor Development', location: 'Boston' },
    ...leaders.map((l) => ({
      id: l.id,
      name: l.name,
      title: 'Branch Leader',
      location: l.location,
    })),
    ...advisors.map((a) => ({
      id: a.id,
      name: a.name,
      title: 'Financial Advisor',
      location: a.leader.location,
    })),
  ];
  yield* db.insert(schema.person).values(
    people.map((p) => ({
      id: p.id,
      tenantId,
      email: `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@northwind.example`,
      displayName: p.name,
      title: p.title,
      location: p.location,
    })),
  );
  yield* db.insert(schema.personPosition).values(
    people.map((p) => ({
      id: PositionId.generate(),
      tenantId,
      personId: p.id,
      title: p.title,
      validFrom: start,
      source: 'seed' as const,
    })),
  );
  yield* db.insert(schema.reportingLine).values([
    ...[owner, ...leaders].map((l) => ({
      id: ReportingLineId.generate(),
      tenantId,
      managerId: rhea,
      reportId: l.id,
      validFrom: start,
      source: 'seed',
    })),
    ...advisors.map((a) => ({
      id: ReportingLineId.generate(),
      tenantId,
      managerId: a.leader.id,
      reportId: a.id,
      validFrom: start,
      source: 'seed',
    })),
  ]);
  yield* db.insert(schema.roleGrant).values({
    id: RoleGrantId.generate(),
    tenantId,
    personId: owner.id,
    role: 'program_owner',
    validFrom: start,
    source: 'seed',
  });
  const coached = advisors.flatMap((a) => (a.coach ? [{ ...a, coach: a.coach }] : []));
  if (coached.length > 0) {
    yield* db.insert(schema.engagement).values(
      coached.map((a) => ({
        id: EngagementId.generate(),
        tenantId,
        coachId: a.coach,
        coacheeId: a.id,
        proposedById: a.coach,
        status: 'active',
        acceptedOn: start,
      })),
    );
  }

  const actor = (id: PersonId, name: string, grants: Actor['grants'] = []): Actor => ({
    tenantId,
    personId: id,
    displayName: name,
    grants: [...grants],
  });
  const as = <A, E, R>(who: Actor, daysAgo: number, effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(CurrentActor, who),
      Effect.provideService(Clock.Clock, fixedClock(Date.parse(`${ago(daysAgo)}T16:00:00Z`))),
    );

  for (const a of advisors) {
    const me = actor(a.id, a.name);
    const observerOf = () =>
      a.coach && rand() < 0.4
        ? actor(a.coach, 'Coach', ['coach'])
        : actor(a.leader.id, a.leader.name);
    const template = pick(SEED_TEMPLATES.filter((t) => t.kind === 'client_meeting'));
    const focus = template.skills.slice(0, 2).map((slug) => skills.get(slug) as SkillId);
    const planId: PlanId = yield* as(
      me,
      90,
      createPlan({
        title: 'This half: client conversations',
        intent: 'Get better at the conversations that build trust with new clients.',
        periodStart: ago(90),
        periodEnd: addDaysIso(on, 90),
        focusSkills: focus.map((skillId) => ({ skillId, targetLevel: 3 as Level })),
      }),
    );
    yield* as(
      me,
      90,
      addActivity(planId, {
        templateId: templates.get(template.slug) ?? null,
        title: template.name,
        description: template.description,
        targetSkillIds: focus,
        dueOn: addDaysIso(on, 60),
        intendedObserverId: a.leader.id,
        intendedMode: 'saw_it',
      }),
    );
    yield* as(me, 90, planEvent(planId, 'PROPOSE'));
    yield* as(
      actor(a.coach ?? a.leader.id, 'Agreer', a.coach ? ['coach'] : []),
      89,
      planEvent(planId, 'AGREE'),
    );
    const [activity] = yield* db
      .select({ id: schema.activity.id })
      .from(schema.activity)
      .where(eq(schema.activity.planId, planId));
    if (!activity) return yield* Effect.die('seed: plan has no activity');
    const activityId = activity.id as ActivityId;

    // Engagement varies: some log weekly, some rarely, a few stop.
    const cadence = 6 + Math.floor(rand() * 14);
    for (let day = 84 - Math.floor(rand() * 7); day > 2; day -= cadence) {
      const occurredOn = ago(day) as IsoDate;
      const interactionId = yield* as(
        me,
        day,
        logInteraction({
          activityId,
          adHocTitle: null,
          adHocSkillIds: [],
          occurredOn,
          kind: template.kind,
          clientRef: null,
          reflection: pick(REFLECTIONS),
        }),
      );
      if (rand() < 0.15) continue; // logged, never asked
      const observer = observerOf();
      const mode: ObservationMode = modeFor(rand(), rand());
      const obsId = yield* as(
        me,
        day,
        requestObservation({
          interactionId,
          observerId: observer.personId,
          mode,
          skillIds: focus,
          note: null,
        }),
      );
      if (rand() < 0.12) continue; // left to expire
      const signDay = Math.max(day - 1 - Math.floor(rand() * 6), 0);
      const progress = (84 - day) / 84;
      yield* as(
        observer,
        signDay,
        signObservation(obsId, {
          version: 1,
          mode,
          ratings: focus.map((skillId) => {
            const level = Math.min(
              4,
              Math.max(1, Math.round(1 + progress * 2 + (rand() - 0.5))),
            ) as Level;
            return {
              skillId,
              level,
              indicatorIds: [],
              suggestedIndicatorIds: [],
              credit: rand() > 0.15,
            };
          }),
          narrativeSaw: pick(SAW),
          narrativeNext: pick(NEXT),
        }),
      );
      if (rand() < 0.7) {
        yield* as(
          me,
          Math.max(signDay - 1, 0),
          transitionObservation(obsId, { event: 'ACKNOWLEDGE', note: null }),
        );
      }
    }
  }
  // Unsigned requests whose window has closed expire, as the scheduler would have done.
  yield* runSweeps();
  yield* Effect.logInfo('seed: practice cohort', { advisors: advisors.length });
});
