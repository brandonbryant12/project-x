import { CurrentActor, type Actor } from '@repo/api';
import {
  ActivityTemplateId,
  BusinessFunctionId,
  EngagementId,
  PersonId,
  ReportingLineId,
  RoleGrantId,
  SkillId,
  SkillIndicatorId,
  SkillVersionId,
  TenantId,
  defaultSkillRole,
  initialCreditPolicy,
  type ActivityId,
  type GrantRole,
  type InteractionKind,
  type IsoDate,
  type Level,
  type ObservationId,
  type ObservationMode,
  type PlanId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { desc, eq } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import {
  addActivity,
  createPlan,
  logInteraction,
  planEvent,
} from '../features/development/use-cases.ts';
import { requestObservation, startObservation } from '../features/observations/use-cases/create.ts';
import { signObservation } from '../features/observations/use-cases/sign.ts';
import { transitionObservation } from '../features/observations/use-cases/transition.ts';
import { addDaysIso, fixedClock, today } from '../platform/time.ts';
import { SEED_SKILLS, SEED_TEMPLATES } from './seed-catalog.ts';

/**
 * Seeds a fictional firm. Directory and catalog are inserted directly (they
 * mirror external systems); every development record is created by running the
 * real use cases as each persona, so seeded data obeys every rule and trigger.
 * Run it with `pnpm db:seed` / `pnpm db:reset` (scripts/seed.ts).
 */
const TENANT_SLUG = 'northwind';

type Key =
  | 'rhea'
  | 'leo'
  | 'priya'
  | 'sam'
  | 'jordan'
  | 'maya'
  | 'daniel'
  | 'aisha'
  | 'tom'
  | 'grace'
  | 'marcus'
  | 'elena'
  | 'nina';
const PEOPLE: ReadonlyArray<{
  key: Key;
  name: string;
  title: string;
  fn: string;
  location: string;
  manager?: Key;
  grants?: ReadonlyArray<GrantRole>;
}> = [
  {
    key: 'rhea',
    name: 'Rhea Castillo',
    title: 'Managing Director',
    fn: 'Leadership',
    location: 'Boston',
    grants: ['tenant_admin'],
  },
  {
    key: 'leo',
    name: 'Leo Okonkwo',
    title: 'Branch Leader',
    fn: 'Leadership',
    location: 'Boston',
    manager: 'rhea',
  },
  {
    key: 'priya',
    name: 'Priya Raman',
    title: 'Branch Leader',
    fn: 'Leadership',
    location: 'Hartford',
    manager: 'rhea',
  },
  {
    key: 'sam',
    name: 'Sam Rivera',
    title: 'Senior Practice Coach',
    fn: 'Practice Development',
    location: 'Boston',
    manager: 'rhea',
    grants: ['coach'],
  },
  {
    key: 'jordan',
    name: 'Jordan Blake',
    title: 'Practice Coach',
    fn: 'Practice Development',
    location: 'Hartford',
    manager: 'rhea',
    grants: ['coach'],
  },
  {
    key: 'elena',
    name: 'Elena Brooks',
    title: 'Head of Practice Development',
    fn: 'Practice Development',
    location: 'Boston',
    manager: 'rhea',
  },
  {
    key: 'nina',
    name: 'Nina Patel',
    title: 'Compliance Principal',
    fn: 'Compliance',
    location: 'Boston',
    manager: 'rhea',
    grants: ['compliance_reviewer'],
  },
  {
    key: 'maya',
    name: 'Maya Chen',
    title: 'Financial Advisor',
    fn: 'Advisory',
    location: 'Boston',
    manager: 'leo',
  },
  {
    key: 'daniel',
    name: 'Daniel Okafor',
    title: 'Associate Advisor',
    fn: 'Advisory',
    location: 'Boston',
    manager: 'leo',
  },
  {
    key: 'aisha',
    name: 'Aisha Bello',
    title: 'Financial Advisor',
    fn: 'Advisory',
    location: 'Boston',
    manager: 'leo',
  },
  {
    key: 'tom',
    name: 'Tom Whitaker',
    title: 'Senior Financial Advisor',
    fn: 'Advisory',
    location: 'Hartford',
    manager: 'priya',
  },
  {
    key: 'marcus',
    name: 'Marcus Hill',
    title: 'Financial Advisor',
    fn: 'Advisory',
    location: 'Hartford',
    manager: 'priya',
  },
  {
    key: 'grace',
    name: 'Grace Liu',
    title: 'Client Service Associate',
    fn: 'Client Service',
    location: 'Hartford',
    manager: 'priya',
  },
];
const ENGAGEMENTS: ReadonlyArray<[coach: Key, coachee: Key]> = [
  ['sam', 'maya'],
  ['sam', 'daniel'],
  ['sam', 'leo'],
  ['jordan', 'aisha'],
  ['jordan', 'tom'],
];

const seedDirectoryAndCatalog = Effect.gen(function* () {
  const db = yield* Db;
  const tenantId = TenantId.generate();
  yield* db.insert(schema.tenant).values({
    id: tenantId,
    name: 'Northwind Wealth Partners',
    slug: TENANT_SLUG,
    timeZone: 'America/New_York',
    // Every new tenant stores the complete working defaults as version 1 (design §2).
    settings: { creditPolicy: initialCreditPolicy() },
  });
  const functions = new Map<string, BusinessFunctionId>();
  for (const name of new Set(PEOPLE.map((p) => p.fn))) {
    const id = BusinessFunctionId.generate();
    functions.set(name, id);
    yield* db.insert(schema.businessFunction).values({ id, tenantId, name });
  }
  const ids = new Map<Key, PersonId>(PEOPLE.map((p) => [p.key, PersonId.generate()]));
  const id = (key: Key) => ids.get(key) as PersonId;
  yield* db.insert(schema.person).values(
    PEOPLE.map((p) => ({
      id: id(p.key),
      tenantId,
      email: `${p.name.toLowerCase().replace(' ', '.')}@northwind.example`,
      displayName: p.name,
      title: p.title,
      location: p.location,
      businessFunctionId: functions.get(p.fn) ?? null,
    })),
  );
  const since = '2025-01-01' as IsoDate;
  yield* db.insert(schema.reportingLine).values(
    PEOPLE.flatMap((p) =>
      p.manager
        ? [
            {
              id: ReportingLineId.generate(),
              tenantId,
              managerId: id(p.manager),
              reportId: id(p.key),
              validFrom: since,
            },
          ]
        : [],
    ),
  );
  yield* db.insert(schema.roleGrant).values(
    PEOPLE.flatMap((p) =>
      (p.grants ?? []).map((role) => ({
        id: RoleGrantId.generate(),
        tenantId,
        personId: id(p.key),
        role,
        validFrom: since,
        source: 'seed',
      })),
    ),
  );
  yield* db.insert(schema.engagement).values(
    ENGAGEMENTS.map(([coach, coachee]) => ({
      id: EngagementId.generate(),
      tenantId,
      coachId: id(coach),
      coacheeId: id(coachee),
      proposedById: id(coachee),
      status: 'active',
      acceptedOn: '2025-06-01' as IsoDate,
    })),
  );
  yield* db.insert(schema.engagement).values({
    id: EngagementId.generate(),
    tenantId,
    coachId: id('jordan'),
    coacheeId: id('marcus'),
    proposedById: id('marcus'),
    status: 'proposed',
    note: 'I want to get better at the volatility calls. Could we work on that this quarter?',
    expiresAt: new Date(Date.now() + 10 * 86_400_000),
  });

  const skills = new Map<string, SkillId>();
  for (const s of SEED_SKILLS) {
    const skillId = SkillId.generate();
    const versionId = SkillVersionId.generate();
    skills.set(s.slug, skillId);
    yield* db.insert(schema.skill).values({
      id: skillId,
      tenantId,
      slug: s.slug,
      name: s.name,
      summary: s.summary,
      domain: s.domain,
      outcome: s.outcome,
      tags: [...s.tags],
      status: 'published',
    });
    yield* db.insert(schema.skillVersion).values({
      id: versionId,
      tenantId,
      skillId,
      number: 1,
      publishedById: id('elena'),
      publishedAt: new Date(),
      changeNote: 'Starter catalog',
    });
    yield* db.insert(schema.skillLevel).values(
      s.levels.map((l, i) => ({
        tenantId,
        skillVersionId: versionId,
        level: i + 1,
        summary: l.summary,
      })),
    );
    yield* db.insert(schema.skillIndicator).values(
      s.levels.flatMap((l, i) =>
        l.indicators.map(([lineageKey, text], position) => ({
          id: SkillIndicatorId.generate(),
          tenantId,
          skillVersionId: versionId,
          level: i + 1,
          lineageKey,
          text,
          position,
        })),
      ),
    );
    yield* db
      .update(schema.skill)
      .set({ currentVersionId: versionId })
      .where(eq(schema.skill.id, skillId));
  }
  const templates = new Map<string, ActivityTemplateId>();
  for (const t of SEED_TEMPLATES) {
    const templateId = ActivityTemplateId.generate();
    templates.set(t.slug, templateId);
    yield* db.insert(schema.activityTemplate).values({
      id: templateId,
      tenantId,
      slug: t.slug,
      name: t.name,
      description: t.description,
      kind: t.kind,
      typicalMinutes: t.minutes,
      observationTip: t.tip,
      status: 'published',
    });
    yield* db.insert(schema.activityTemplateSkill).values(
      t.skills.map((slug, position) => ({
        tenantId,
        templateId,
        skillId: skills.get(slug) as SkillId,
        position,
        role: defaultSkillRole(position),
      })),
    );
  }
  return { tenantId, id, skills, templates };
});

const scenario = (world: Effect.Success<typeof seedDirectoryAndCatalog>) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const on = yield* today;
    const ago = (days: number) => addDaysIso(on, -days);
    const skill = (slug: string) => world.skills.get(slug) as SkillId;
    const template = (slug: string) => world.templates.get(slug) as ActivityTemplateId;
    const actorOf = (key: Key): Actor => {
      const p = PEOPLE.find((x) => x.key === key);
      return {
        tenantId: world.tenantId,
        personId: world.id(key),
        displayName: p?.name ?? key,
        grants: [...(p?.grants ?? [])],
      };
    };
    const as = <A, E, R>(key: Key, effect: Effect.Effect<A, E, R>) =>
      Effect.provideService(effect, CurrentActor, actorOf(key));
    /** Replays a step on the day it happened, so time windows and timestamps are honest. */
    const onDay = <A, E, R>(daysAgo: number, effect: Effect.Effect<A, E, R>) =>
      Effect.provideService(
        effect,
        Clock.Clock,
        fixedClock(Date.parse(`${ago(daysAgo)}T17:00:00Z`)),
      );

    const plan = (
      owner: Key,
      coach: Key,
      title: string,
      intent: string,
      focus: ReadonlyArray<[string, Level]>,
      activities: ReadonlyArray<[string, string]>,
      agree = true,
    ) =>
      Effect.gen(function* () {
        const planId: PlanId = yield* onDay(
          70,
          as(
            owner,
            createPlan({
              title,
              intent,
              periodStart: ago(70),
              periodEnd: addDaysIso(on, 110),
              focusSkills: focus.map(([slug, targetLevel]) => ({
                skillId: skill(slug),
                targetLevel,
              })),
            }),
          ),
        );
        for (const [slug, title$] of activities) {
          const t = SEED_TEMPLATES.find((x) => x.slug === slug);
          yield* onDay(
            70,
            as(
              owner,
              addActivity(planId, {
                templateId: template(slug),
                title: title$,
                description: t?.description ?? '',
                targetSkillIds: (t?.skills ?? []).slice(0, 2).map(skill),
                dueOn: addDaysIso(on, 60),
                intendedObserverId: world.id(coach),
                intendedMode: 'saw_it',
              }),
            ),
          );
        }
        yield* onDay(70, as(owner, planEvent(planId, 'PROPOSE')));
        if (agree) yield* onDay(69, as(coach, planEvent(planId, 'AGREE')));
        return planId;
      });
    const activityOf = (planId: PlanId, index: number) =>
      db
        .select({ id: schema.activity.id })
        .from(schema.activity)
        .where(eq(schema.activity.planId, planId))
        .orderBy(schema.activity.createdAt)
        .pipe(Effect.map((rows) => rows[index]?.id as ActivityId));
    const log = (
      owner: Key,
      activityId: ActivityId,
      daysAgo: number,
      kind: InteractionKind,
      reflection: string,
    ) =>
      onDay(
        daysAgo,
        as(
          owner,
          logInteraction({
            activityId,
            adHocTitle: null,
            adHocSkillIds: [],
            occurredOn: ago(daysAgo),
            kind,
            clientRef: null,
            reflection,
          }),
        ),
      );
    const observe = (
      owner: Key,
      observer: Key,
      interactionId: Effect.Success<ReturnType<typeof log>>,
      mode: ObservationMode,
      ratings: ReadonlyArray<[string, Level]>,
      saw: string,
      next: string,
      daysAgo: number,
    ) =>
      Effect.gen(function* () {
        const obsId: ObservationId = yield* onDay(
          daysAgo,
          as(
            owner,
            requestObservation({
              interactionId,
              observerId: world.id(observer),
              mode,
              skillIds: ratings.map(([s]) => skill(s)),
              note: null,
            }),
          ),
        );
        yield* onDay(
          Math.max(daysAgo - 1, 0),
          as(
            observer,
            signObservation(obsId, {
              version: 1,
              mode,
              ratings: ratings.map(([s, level]) => ({
                skillId: skill(s),
                level,
                indicatorIds: [],
                credit: true,
              })),
              narrativeSaw: saw,
              narrativeNext: next,
            }),
          ),
        );
        return obsId;
      });

    // Maya: earns Client discovery across two observers and seven weeks.
    const mayaPlan = yield* plan(
      'maya',
      'sam',
      'Lead with discovery',
      'I want my first meetings to change the plan, not confirm my assumptions.',
      [
        ['client-discovery', 3],
        ['behavioral-coaching', 3],
      ],
      [
        ['discovery-meeting', 'Discovery meetings with new households'],
        ['volatility-check-in', 'Proactive calls after market drops'],
        ['annual-review', 'Lead the goals conversation in annual reviews'],
      ],
    );
    const discovery = yield* activityOf(mayaPlan, 0);
    const volatility = yield* activityOf(mayaPlan, 1);
    const i1 = yield* log(
      'maya',
      discovery,
      56,
      'client_meeting',
      'First meeting with a couple planning an early retirement. I used the new discovery guide and spent most of the hour on what retirement would look like day to day.',
    );
    yield* observe(
      'maya',
      'sam',
      i1,
      'saw_it',
      // Explaining simply is a supporting (secondary) skill of discovery work:
      // Maya is part-way to that badge through secondary credit alone.
      [
        ['client-discovery', 3],
        ['explaining-simply', 2],
      ],
      'Maya asked what a good Tuesday in retirement would look like, then summarized their three priorities back before showing any numbers. The couple visibly relaxed.',
      'Next time, ask each partner separately about trade-offs; one of them deferred a lot.',
      56,
    );
    const i2 = yield* log(
      'maya',
      discovery,
      30,
      'client_meeting',
      'Discovery with a business owner selling their company next year. Recorded with consent for review with my leader.',
    );
    yield* observe(
      'maya',
      'leo',
      i2,
      'reviewed_work',
      [
        ['client-discovery', 3],
        ['explaining-simply', 2],
      ],
      'In the recording Maya surfaced the owner’s worry about staff after the sale, which he had not raised. She held off on the liquidity discussion until he had finished.',
      'Bring that staff concern into the plan explicitly at the next meeting.',
      30,
    );
    const i3 = yield* log(
      'maya',
      volatility,
      20,
      'client_meeting',
      'Called three anxious clients after the market drop. One wanted to move everything to cash.',
    );
    yield* observe(
      'maya',
      'sam',
      i3,
      'saw_it',
      [['behavioral-coaching', 2]],
      'Maya named the client’s fear before giving any information and brought the conversation back to the plan’s timeline. She avoided predicting the market.',
      'Try asking what would need to be true to stay invested, rather than offering the answer.',
      20,
    );
    const i4 = yield* log(
      'maya',
      discovery,
      9,
      'client_meeting',
      'Second discovery meeting with a widow taking over the family finances.',
    );
    yield* observe(
      'maya',
      'sam',
      i4,
      'discussed',
      [['client-discovery', 3]],
      'In our debrief Maya described pausing to let the client talk about her late husband’s approach, then asking what she wanted to keep and what she wanted to change.',
      'Ask her next time how confident she feels making decisions alone, and write it down.',
      9,
    );
    const i5 = yield* log(
      'maya',
      volatility,
      2,
      'client_meeting',
      'Follow-up call with the client who wanted to move to cash. We agreed a checkpoint in two weeks instead.',
    );
    yield* as(
      'maya',
      requestObservation({
        interactionId: i5,
        observerId: world.id('leo'),
        mode: 'reviewed_work',
        skillIds: [skill('behavioral-coaching')],
        note: 'Could you listen to the recording? I tried your checkpoint idea.',
      }),
    );

    // Daniel: plan waiting for Sam's agreement, plus a request waiting on Sam.
    const danielPlan = yield* plan(
      'daniel',
      'sam',
      'Explain things simply',
      'Clients nod but I am not sure they follow me.',
      [['explaining-simply', 2]],
      [['proposal-walkthrough', 'Walk households through proposals']],
      false,
    );
    const danielActivity = yield* activityOf(danielPlan, 0);
    const d1 = yield* log(
      'daniel',
      danielActivity,
      3,
      'presentation',
      'Walked a young family through their education savings proposal using a simple drawing of the timeline.',
    );
    yield* as(
      'daniel',
      requestObservation({
        interactionId: d1,
        observerId: world.id('sam'),
        mode: 'discussed',
        skillIds: [skill('explaining-simply')],
        note: null,
      }),
    );

    // Aisha: an observation sent back to her, and a reflection held for privacy.
    const aishaPlan = yield* plan(
      'aisha',
      'jordan',
      'Be candid about fees',
      'I avoid the fee conversation until clients raise it.',
      [['transparency', 3]],
      [['fees-conversation', 'Raise fees in every annual review']],
    );
    const aishaActivity = yield* activityOf(aishaPlan, 0);
    const a1 = yield* log(
      'aisha',
      aishaActivity,
      6,
      'client_meeting',
      'Raised the advisory fee at the start of the annual review and compared it with what they would pay elsewhere.',
    );
    const a1Obs = yield* as(
      'aisha',
      requestObservation({
        interactionId: a1,
        observerId: world.id('jordan'),
        mode: 'discussed',
        skillIds: [skill('transparency')],
        note: null,
      }),
    );
    yield* as(
      'jordan',
      transitionObservation(a1Obs, {
        event: 'RETURN',
        note: 'Tell me more about how they reacted when you compared the fee. What did you say next?',
      }),
    );
    yield* log(
      'aisha',
      aishaActivity,
      1,
      'client_meeting',
      'Mrs. Patterson asked about fees on her account number 4417 2291 before I could raise it.',
    );

    // Tom: someone others can learn from (two observers, ten weeks).
    const tomPlan = yield* plan(
      'tom',
      'jordan',
      'Steady hands',
      'Keep clients invested through the next downturn.',
      [['behavioral-coaching', 3]],
      [['volatility-check-in', 'Volatility calls with long-standing clients']],
    );
    const tomActivity = yield* activityOf(tomPlan, 0);
    const t1 = yield* log(
      'tom',
      tomActivity,
      68,
      'client_meeting',
      'Call with a retired client who wanted to sell everything after a bad week.',
    );
    yield* observe(
      'tom',
      'priya',
      t1,
      'saw_it',
      [['behavioral-coaching', 3]],
      'Tom asked the client what the money was for and let him answer at length. He reframed the drop against the twenty-year plan, and the client chose to wait.',
      'Share how you set up that question with the newer advisors.',
      68,
    );
    const t2 = yield* log(
      'tom',
      tomActivity,
      40,
      'client_meeting',
      'Quarterly call with a couple nervous about rates.',
    );
    yield* observe(
      'tom',
      'jordan',
      t2,
      'saw_it',
      [['behavioral-coaching', 3]],
      'Tom asked questions until the couple reached the decision themselves and agreed a checkpoint for next quarter rather than making a change.',
      'Write down the questions you use; others could learn from them.',
      40,
    );
    const t3 = yield* log(
      'tom',
      tomActivity,
      12,
      'client_meeting',
      'Call with a client whose neighbor had sold out of equities.',
    );
    yield* observe(
      'tom',
      'jordan',
      t3,
      'reviewed_work',
      [['behavioral-coaching', 3]],
      'On the recording Tom acknowledged the social pressure first, then reconnected to the client’s own goals without arguing with the neighbor’s choice.',
      'Keep going; consider running a team session on this.',
      12,
    );

    // Leo develops too: Sam saw him coach his team ("I saw this").
    yield* plan(
      'leo',
      'sam',
      'Coach, don’t just manage',
      'Spend more time observing and less time reviewing numbers.',
      [['coaching-your-team', 3]],
      [['team-huddle', 'Weekly huddles focused on one skill']],
    );
    const huddle = yield* as(
      'sam',
      startObservation({
        subjectId: world.id('leo'),
        activityId: null,
        title: 'Monday team huddle',
        occurredOn: ago(5),
        kind: 'team_conversation',
        mode: 'saw_it',
        skillIds: [skill('coaching-your-team')],
      }),
    );
    const [row] = yield* db
      .select({ version: schema.observation.version })
      .from(schema.observation)
      .where(eq(schema.observation.id, huddle));
    yield* as(
      'sam',
      signObservation(huddle, {
        version: row?.version ?? 1,
        mode: 'saw_it',
        ratings: [
          {
            skillId: skill('coaching-your-team'),
            level: 2,
            indicatorIds: [],
            credit: true,
          },
        ],
        narrativeSaw:
          'Leo opened the huddle with one advisor’s recorded call and asked the team what they noticed before giving his view. Two people left with a specific thing to try.',
        narrativeNext: 'Follow up on those two commitments at next week’s huddle.',
      }),
    );
  });

/** Seeds the fictional firm if absent. Used by `pnpm db:seed` and by scenario tests. */
export const seedWorld = Effect.gen(function* () {
  const db = yield* Db;
  const [existing] = yield* db
    .select()
    .from(schema.tenant)
    .where(eq(schema.tenant.slug, TENANT_SLUG));
  if (existing) {
    yield* Effect.logInfo('seed: tenant already exists; run `pnpm db:reset` to start over');
    return undefined;
  }
  const world = yield* seedDirectoryAndCatalog;
  yield* scenario(world);
  const badges = yield* db
    .select()
    .from(schema.badgeAward)
    .orderBy(desc(schema.badgeAward.awardedAt));
  yield* Effect.logInfo(
    `seed: done — ${PEOPLE.length} people, ${SEED_SKILLS.length} skills, ${badges.length} badges awarded`,
  );
  return world;
});

export type SeedKey = Key;
