import * as Domain from '@alchemy.run/domain';
import { Story } from '@alchemy.run/domain/Story';
import { it } from '@effect/vitest';
import { Layer } from 'effect';
import { describe, expect } from 'vitest';
import {
  EngagementId,
  InteractionId,
  ObservationId,
  PersonId,
  PlanId,
  SkillId,
  SkillVersionId,
  TenantId,
  type IsoDate,
} from '../ids.ts';
import { DEFAULT_BADGE_CRITERIA, STRICT_BADGE_CRITERIA } from '../scoring/badges.ts';
import { AuditTrailQuery } from './AuditTrail.projection.ts';
import { CoachingHandlers, CoachingModel } from './Coaching.model.ts';
import { CoachingActor, personActor } from './CoachingActor.context.ts';
import {
  AcceptEngagement,
  CoachingEngagement,
  EngagementAccepted,
  EngagementProposed,
  ProposeEngagement,
} from './CoachingEngagement.aggregate.ts';
import {
  AgreeDevelopmentPlan,
  CreateDevelopmentPlan,
  DevelopmentPlan,
  DevelopmentPlanAgreed,
  DevelopmentPlanCreated,
  DevelopmentPlanProposed,
  ProposeDevelopmentPlan,
} from './DevelopmentPlan.aggregate.ts';
import { Observation } from './Observation.aggregate.ts';
import {
  ObservationRequested,
  ObservationSigned,
  ObservationStarted,
  ObservationVoided,
  RequestObservation,
  SignObservation,
  StartObservation,
  VoidObservation,
} from './Observation.commands.ts';
import { MemoryAuditTrailStore, NotificationGateway } from './Ports.ts';
import {
  InvalidDomainInput,
  personMasteryKey,
  PrivacyViolation,
  skillLedgerId,
  UnauthorizedActor,
} from './Shared.ts';
import {
  AttachPlaybookResource,
  PlaybookResourceAttached,
  PlaybookResourceRemoved,
  PublishSkill,
  PublishSkillVersion,
  RemovePlaybookResource,
  SkillCatalog,
  SkillPublished,
  SkillVersionPublished,
} from './SkillCatalog.aggregate.ts';
import {
  BadgeAwarded,
  BadgeRevoked,
  DemonstrationRecorded,
  DemonstrationReversed,
  ReevaluateStanding,
  SkillLedger,
} from './SkillLedger.aggregate.ts';
import { TenantPolicy, TenantPolicyUpdated, UpdateTenantPolicy } from './TenantPolicy.aggregate.ts';
import {
  ObservationMilestone,
  ObservationSummaryView,
  PersonMasteryView,
  TenantCatalogView,
} from './Views.ts';

const TENANT = TenantId.generate();
const OTHER_TENANT = TenantId.generate();
const ADVISOR = PersonId.generate();
const MANAGER = PersonId.generate();
const COACH = PersonId.generate();
const ADMIN = PersonId.generate();
const REVIEWER = PersonId.generate();
const SKILL_ID = SkillId.generate();
const SKILL_VER = SkillVersionId.generate();

const story = Story.make(CoachingModel, {
  layer: CoachingHandlers.pipe(Layer.provide(MemoryAuditTrailStore)),
  stub: [NotificationGateway],
});

const FOUR_LEVELS = [
  { level: 1 as const, summary: 'Applies basics with guide.', indicators: ['Uses checklist'] },
  { level: 2 as const, summary: 'Applies consistently.', indicators: ['Asks open questions'] },
  { level: 3 as const, summary: 'Leads independently.', indicators: ['Reframes trade-offs'] },
  { level: 4 as const, summary: 'Coaches peers.', indicators: ['Debriefs colleagues'] },
];

describe('CoachingModel (@alchemy.run/domain)', () => {
  it('passes static Domain.verify with zero DefinitionErrors', () => {
    expect(Domain.verify(CoachingModel)).toEqual([]);
  });

  it.effect(
    'signs 2 observations → posts credit → awards L2+L3 badges → updates views, notifications & audit',
    () => {
      const obs1 = Observation.ref(ObservationId.generate());
      const obs2 = Observation.ref(ObservationId.generate());
      const int1 = InteractionId.generate();
      const int2 = InteractionId.generate();
      const ledger = SkillLedger.ref(skillLedgerId(TENANT, ADVISOR, SKILL_ID));
      const masteryKey = personMasteryKey(TENANT, ADVISOR);

      return story(
        Story.provide(CoachingActor, personActor(TENANT, ADVISOR)),
        Story.when(
          obs1,
          new RequestObservation({
            subjectId: ADVISOR,
            observerId: MANAGER,
            interactionId: int1,
            occurredOn: '2026-11-10' as IsoDate,
            basis: 'leader',
            mode: 'saw_it',
            skillIds: [SKILL_ID],
          }),
        ),
        Story.call(NotificationGateway.dispatch, {
          tenantId: TENANT,
          recipientId: MANAGER,
          kind: 'observation_requested',
        }),
        Story.succeed(NotificationGateway.dispatch, { queued: true }),
        Story.then(
          obs1,
          new ObservationRequested({
            tenantId: TENANT,
            subjectId: ADVISOR,
            observerId: MANAGER,
            requestedById: ADVISOR,
            interactionId: int1,
            occurredOn: '2026-11-10' as IsoDate,
            basis: 'leader',
            mode: 'saw_it',
            requestedSkillIds: [SKILL_ID],
          }),
        ),
        // Manager signs observation #1 (first-hand, Level 3)
        Story.provide(CoachingActor, personActor(TENANT, MANAGER)),
        Story.when(
          obs1,
          new SignObservation({
            mode: 'saw_it',
            ratings: [
              {
                skillId: SKILL_ID,
                skillVersionId: SKILL_VER,
                level: 3,
                credit: true,
                indicatorIds: [],
              },
            ],
            narrativeSaw: 'Paused cleanly and reflected both spouses priorities before proposing.',
            narrativeNext: 'Confirm timeline constraints earlier.',
            contentDigest: 'sha256-obs1',
          }),
        ),
        Story.call(NotificationGateway.dispatch, {
          tenantId: TENANT,
          recipientId: ADVISOR,
          kind: 'observation_signed',
        }),
        Story.succeed(NotificationGateway.dispatch, { queued: true }),
        Story.then(
          obs1,
          new ObservationSigned({
            tenantId: TENANT,
            subjectId: ADVISOR,
            observerId: MANAGER,
            interactionId: int1,
            occurredOn: '2026-11-10' as IsoDate,
            basis: 'leader',
            mode: 'saw_it',
            ratings: [
              {
                skillId: SKILL_ID,
                skillVersionId: SKILL_VER,
                level: 3,
                credit: true,
                indicatorIds: [],
              },
            ],
            contentDigest: 'sha256-obs1',
          }),
        ),
        Story.then(
          ledger,
          new DemonstrationRecorded({
            tenantId: TENANT,
            personId: ADVISOR,
            skillId: SKILL_ID,
            observationId: obs1.id,
            interactionId: int1,
            observerId: MANAGER,
            level: 3,
            mode: 'saw_it',
            demonstratedOn: '2026-11-10' as IsoDate,
          }),
        ),
        Story.view(PersonMasteryView, masteryKey, {
          skills: [{ skillId: SKILL_ID, netDemonstrations: 1, heldBadges: [] }],
        }),
        Story.emitted(ObservationSummaryView, obs1, [
          new ObservationMilestone({
            observationId: obs1.id,
            status: 'signed',
            creditedSkillCount: 1,
          }),
        ]),
        // Manager starts & signs observation #2 → crosses default threshold (2 demos, 50% first-hand)
        Story.when(
          obs2,
          new StartObservation({
            subjectId: ADVISOR,
            interactionId: int2,
            occurredOn: '2026-11-12' as IsoDate,
            basis: 'leader',
            mode: 'discussed',
            skillIds: [SKILL_ID],
          }),
        ),
        Story.then(
          obs2,
          new ObservationStarted({
            tenantId: TENANT,
            subjectId: ADVISOR,
            observerId: MANAGER,
            interactionId: int2,
            occurredOn: '2026-11-12' as IsoDate,
            basis: 'leader',
            mode: 'discussed',
            skillIds: [SKILL_ID],
          }),
        ),
        Story.when(
          obs2,
          new SignObservation({
            mode: 'discussed',
            ratings: [
              {
                skillId: SKILL_ID,
                skillVersionId: SKILL_VER,
                level: 3,
                credit: true,
                indicatorIds: [],
              },
            ],
            narrativeSaw: 'Debriefed the retirement trade-off conversation clearly and calmly.',
            narrativeNext: 'Summarize agreed next step at close.',
            contentDigest: 'sha256-obs2',
          }),
        ),
        Story.call(NotificationGateway.dispatch, {
          tenantId: TENANT,
          recipientId: ADVISOR,
          kind: 'observation_signed',
        }),
        Story.succeed(NotificationGateway.dispatch, { queued: true }),
        Story.then(
          obs2,
          new ObservationSigned({
            tenantId: TENANT,
            subjectId: ADVISOR,
            observerId: MANAGER,
            interactionId: int2,
            occurredOn: '2026-11-12' as IsoDate,
            basis: 'leader',
            mode: 'discussed',
            ratings: [
              {
                skillId: SKILL_ID,
                skillVersionId: SKILL_VER,
                level: 3,
                credit: true,
                indicatorIds: [],
              },
            ],
            contentDigest: 'sha256-obs2',
          }),
        ),
        Story.then(
          ledger,
          new DemonstrationRecorded({
            tenantId: TENANT,
            personId: ADVISOR,
            skillId: SKILL_ID,
            observationId: obs2.id,
            interactionId: int2,
            observerId: MANAGER,
            level: 3,
            mode: 'discussed',
            demonstratedOn: '2026-11-12' as IsoDate,
          }),
          new BadgeAwarded({
            tenantId: TENANT,
            personId: ADVISOR,
            skillId: SKILL_ID,
            level: 2,
            triggerObservationId: obs2.id,
          }),
          new BadgeAwarded({
            tenantId: TENANT,
            personId: ADVISOR,
            skillId: SKILL_ID,
            level: 3,
            triggerObservationId: obs2.id,
          }),
        ),
        Story.view(PersonMasteryView, masteryKey, {
          skills: [{ skillId: SKILL_ID, netDemonstrations: 2, heldBadges: [2, 3] }],
        }),
        // Admin can query tenant audit trail; cross-tenant query is rejected
        Story.provide(CoachingActor, personActor(TENANT, ADMIN, ['tenant_admin'])),
        Story.query(AuditTrailQuery, { tenantId: TENANT }, (page) => {
          if (page.entries.length < 6) {
            throw new Error(`Expected >= 6 audit trail entries, got ${page.entries.length}`);
          }
        }),
        Story.provide(CoachingActor, personActor(OTHER_TENANT, ADMIN, ['tenant_admin'])),
        Story.query(AuditTrailQuery, { tenantId: TENANT }),
        Story.rejected(
          new UnauthorizedActor({
            action: 'AuditTrailQuery',
            reason: 'Cannot query audit trail for another tenant.',
          }),
        ),
      );
    },
  );

  it.effect('blocks signing on client PII and reverses credit + revokes badges on VOID', () => {
    const obs1 = Observation.ref(ObservationId.generate());
    const obs2 = Observation.ref(ObservationId.generate());
    const int1 = InteractionId.generate();
    const int2 = InteractionId.generate();
    const ledger = SkillLedger.ref(skillLedgerId(TENANT, ADVISOR, SKILL_ID));

    return story(
      Story.given(
        obs1,
        new ObservationStarted({
          tenantId: TENANT,
          subjectId: ADVISOR,
          observerId: MANAGER,
          interactionId: int1,
          occurredOn: '2026-11-10' as IsoDate,
          basis: 'leader',
          mode: 'saw_it',
          skillIds: [SKILL_ID],
        }),
        new ObservationSigned({
          tenantId: TENANT,
          subjectId: ADVISOR,
          observerId: MANAGER,
          interactionId: int1,
          occurredOn: '2026-11-10' as IsoDate,
          basis: 'leader',
          mode: 'saw_it',
          ratings: [
            {
              skillId: SKILL_ID,
              skillVersionId: SKILL_VER,
              level: 3,
              credit: true,
              indicatorIds: [],
            },
          ],
          contentDigest: 'sha256-1',
        }),
      ),
      Story.given(
        ledger,
        new DemonstrationRecorded({
          tenantId: TENANT,
          personId: ADVISOR,
          skillId: SKILL_ID,
          observationId: obs1.id,
          interactionId: int1,
          observerId: MANAGER,
          level: 3,
          mode: 'saw_it',
          demonstratedOn: '2026-11-10' as IsoDate,
        }),
        new DemonstrationRecorded({
          tenantId: TENANT,
          personId: ADVISOR,
          skillId: SKILL_ID,
          observationId: obs2.id,
          interactionId: int2,
          observerId: MANAGER,
          level: 3,
          mode: 'saw_it',
          demonstratedOn: '2026-11-11' as IsoDate,
        }),
        new BadgeAwarded({
          tenantId: TENANT,
          personId: ADVISOR,
          skillId: SKILL_ID,
          level: 2,
          triggerObservationId: obs2.id,
        }),
        new BadgeAwarded({
          tenantId: TENANT,
          personId: ADVISOR,
          skillId: SKILL_ID,
          level: 3,
          triggerObservationId: obs2.id,
        }),
      ),
      // PII rejection on a fresh draft
      Story.given(
        obs2,
        new ObservationStarted({
          tenantId: TENANT,
          subjectId: ADVISOR,
          observerId: MANAGER,
          interactionId: int2,
          occurredOn: '2026-11-11' as IsoDate,
          basis: 'leader',
          mode: 'saw_it',
          skillIds: [SKILL_ID],
        }),
      ),
      Story.provide(CoachingActor, personActor(TENANT, MANAGER)),
      Story.when(
        obs2,
        new SignObservation({
          mode: 'saw_it',
          ratings: [
            {
              skillId: SKILL_ID,
              skillVersionId: SKILL_VER,
              level: 3,
              credit: true,
              indicatorIds: [],
            },
          ],
          narrativeSaw: 'Met with Mr. Henderson about account # 1234567890.',
          narrativeNext: '',
          contentDigest: 'sha256-pii',
        }),
      ),
      Story.rejected(
        new PrivacyViolation({
          reasons: [
            'Looks like an account or card number',
            'Appears to name a client',
            'Mentions an account number',
          ],
        }),
      ),
      // Compliance reviewer voids obs1 → automatic credit reversal + badge revocation!
      Story.provide(CoachingActor, personActor(TENANT, REVIEWER, ['compliance_reviewer'])),
      Story.when(obs1, new VoidObservation({ noteLength: 24 })),
      Story.then(
        obs1,
        new ObservationVoided({
          tenantId: TENANT,
          subjectId: ADVISOR,
          observerId: MANAGER,
          creditedSkillIds: [SKILL_ID],
          voidedById: REVIEWER,
        }),
      ),
      Story.then(
        ledger,
        new DemonstrationReversed({
          tenantId: TENANT,
          personId: ADVISOR,
          skillId: SKILL_ID,
          observationId: obs1.id,
          reasonCode: 'observation_voided',
        }),
        new BadgeRevoked({
          tenantId: TENANT,
          personId: ADVISOR,
          skillId: SKILL_ID,
          level: 2,
          triggerObservationId: obs1.id,
        }),
        new BadgeRevoked({
          tenantId: TENANT,
          personId: ADVISOR,
          skillId: SKILL_ID,
          level: 3,
          triggerObservationId: obs1.id,
        }),
      ),
      Story.view(PersonMasteryView, personMasteryKey(TENANT, ADVISOR), {
        skills: [{ skillId: SKILL_ID, netDemonstrations: 1, heldBadges: [] }],
      }),
    );
  });

  it.effect(
    'enforces TenantPolicy rigor, supports rule-evolution reevaluation, and authors skills + playbooks',
    () => {
      const policyRef = TenantPolicy.ref(TENANT);
      const skillRef = SkillCatalog.ref(SkillId.generate());
      const ledgerRef = SkillLedger.ref(skillLedgerId(TENANT, ADVISOR, SKILL_ID));
      const planRef = DevelopmentPlan.ref(PlanId.generate());
      const engRef = CoachingEngagement.ref(EngagementId.generate());

      return story(
        // Non-admin cannot change policy
        Story.provide(CoachingActor, personActor(TENANT, ADVISOR)),
        Story.when(
          policyRef,
          new UpdateTenantPolicy({
            badgeCriteria: STRICT_BADGE_CRITERIA,
            observationWindowDays: 14,
            auditNote: null,
          }),
        ),
        Story.rejected(
          new UnauthorizedActor({
            action: 'UpdateTenantPolicy',
            reason: 'Only tenant admins can update program policy.',
          }),
        ),
        // Invalid observers > demos rejected
        Story.provide(CoachingActor, personActor(TENANT, ADMIN, ['tenant_admin'])),
        Story.when(
          policyRef,
          new UpdateTenantPolicy({
            badgeCriteria: { ...DEFAULT_BADGE_CRITERIA, minDemonstrations: 2, minObservers: 3 },
            observationWindowDays: 14,
            auditNote: null,
          }),
        ),
        Story.rejected(
          new InvalidDomainInput({
            field: 'badgeCriteria.minObservers',
            reason: 'Minimum distinct observers cannot exceed minimum observations.',
          }),
        ),
        // Admin updates policy to Enterprise Strict
        Story.when(
          policyRef,
          new UpdateTenantPolicy({
            badgeCriteria: STRICT_BADGE_CRITERIA,
            observationWindowDays: 21,
            auditNote: 'Q3 enterprise governance rollout',
          }),
        ),
        Story.then(
          policyRef,
          new TenantPolicyUpdated({
            badgeCriteria: STRICT_BADGE_CRITERIA,
            observationWindowDays: 21,
            hasAuditNote: true,
          }),
        ),
        // Rule evolution: grandfathering vs retroactive reevaluation on stored facts
        Story.given(
          ledgerRef,
          new DemonstrationRecorded({
            tenantId: TENANT,
            personId: ADVISOR,
            skillId: SKILL_ID,
            observationId: ObservationId.generate(),
            interactionId: InteractionId.generate(),
            observerId: MANAGER,
            level: 2,
            mode: 'saw_it',
            demonstratedOn: '2026-11-01' as IsoDate,
          }),
          new DemonstrationRecorded({
            tenantId: TENANT,
            personId: ADVISOR,
            skillId: SKILL_ID,
            observationId: ObservationId.generate(),
            interactionId: InteractionId.generate(),
            observerId: MANAGER,
            level: 2,
            mode: 'saw_it',
            demonstratedOn: '2026-11-02' as IsoDate,
          }),
          new BadgeAwarded({
            tenantId: TENANT,
            personId: ADVISOR,
            skillId: SKILL_ID,
            level: 2,
            triggerObservationId: null,
          }),
        ),
        // Grandfathering keeps earned L2 badge
        Story.when(
          ledgerRef,
          new ReevaluateStanding({ criteria: STRICT_BADGE_CRITERIA, revokeUnmet: false }),
        ),
        Story.then(ledgerRef),
        // Retroactive recalculation revokes unmet L2 under strict rules
        Story.when(
          ledgerRef,
          new ReevaluateStanding({ criteria: STRICT_BADGE_CRITERIA, revokeUnmet: true }),
        ),
        Story.then(
          ledgerRef,
          new BadgeRevoked({
            tenantId: TENANT,
            personId: ADVISOR,
            skillId: SKILL_ID,
            level: 2,
            triggerObservationId: null,
          }),
        ),
        // Skill Catalog Authoring + Versioning + Playbook Resources
        Story.when(
          skillRef,
          new PublishSkill({
            slug: 'estate-transition-readiness',
            name: 'Estate transition readiness',
            domain: 'planning_advice',
            tier: 'common',
            summary: 'Guides families calmly through multi-generation wealth transfers.',
            outcome: 'Family retention',
            tags: ['planning', 'households'],
            levels: FOUR_LEVELS,
          }),
        ),
        Story.then(
          skillRef,
          new SkillPublished({
            tenantId: TENANT,
            slug: 'estate-transition-readiness',
            name: 'Estate transition readiness',
            domain: 'planning_advice',
            tier: 'common',
            summary: 'Guides families calmly through multi-generation wealth transfers.',
            outcome: 'Family retention',
            tags: ['planning', 'households'],
            version: 1,
            levels: FOUR_LEVELS,
          }),
        ),
        Story.when(
          skillRef,
          new PublishSkillVersion({
            slug: 'estate-transition-readiness',
            name: 'Estate transition readiness',
            domain: 'planning_advice',
            tier: 'core',
            summary: 'Promoted to Core skill for senior advisors.',
            outcome: 'Family retention',
            tags: ['planning', 'households'],
            levels: FOUR_LEVELS,
            changeNote: 'Promoted to Core tier',
          }),
        ),
        Story.then(
          skillRef,
          new SkillVersionPublished({
            tenantId: TENANT,
            slug: 'estate-transition-readiness',
            name: 'Estate transition readiness',
            domain: 'planning_advice',
            tier: 'core',
            summary: 'Promoted to Core skill for senior advisors.',
            outcome: 'Family retention',
            tags: ['planning', 'households'],
            version: 2,
            levels: FOUR_LEVELS,
            changeNote: 'Promoted to Core tier',
          }),
        ),
        Story.provide(CoachingActor, personActor(TENANT, COACH, ['coach'])),
        Story.when(
          skillRef,
          new AttachPlaybookResource({
            resource: {
              id: 'res_1',
              level: 3,
              kind: 'playbook',
              title: 'Family meeting agenda',
              summary: 'Use before joint beneficiary reviews.',
              url: null,
              durationMinutes: 10,
            },
          }),
        ),
        Story.then(
          skillRef,
          new PlaybookResourceAttached({
            tenantId: TENANT,
            resource: {
              id: 'res_1',
              level: 3,
              kind: 'playbook',
              title: 'Family meeting agenda',
              summary: 'Use before joint beneficiary reviews.',
              url: null,
              durationMinutes: 10,
            },
          }),
        ),
        Story.view(TenantCatalogView, TENANT, {
          skills: [
            {
              skillId: skillRef.id,
              slug: 'estate-transition-readiness',
              name: 'Estate transition readiness',
              domain: 'planning_advice',
              tier: 'core',
              version: 2,
              resourceCount: 1,
              retired: false,
            },
          ],
        }),
        Story.when(skillRef, new RemovePlaybookResource({ resourceId: 'res_1' })),
        Story.then(
          skillRef,
          new PlaybookResourceRemoved({ tenantId: TENANT, resourceId: 'res_1' }),
        ),
        // Development plan & Coaching engagement lifecycles
        Story.provide(CoachingActor, personActor(TENANT, ADVISOR)),
        Story.when(
          planRef,
          new CreateDevelopmentPlan({ focusSkillIds: [SKILL_ID], startActive: false }),
        ),
        Story.then(
          planRef,
          new DevelopmentPlanCreated({
            tenantId: TENANT,
            ownerId: ADVISOR,
            focusSkillIds: [SKILL_ID],
            status: 'draft',
          }),
        ),
        Story.when(planRef, new ProposeDevelopmentPlan({})),
        Story.call(NotificationGateway.dispatch, {
          tenantId: TENANT,
          recipientId: ADVISOR,
          kind: 'plan_proposed',
        }),
        Story.succeed(NotificationGateway.dispatch, { queued: true }),
        Story.then(planRef, new DevelopmentPlanProposed({ tenantId: TENANT, ownerId: ADVISOR })),
        Story.provide(CoachingActor, personActor(TENANT, MANAGER)),
        Story.when(planRef, new AgreeDevelopmentPlan({})),
        Story.then(planRef, new DevelopmentPlanAgreed({ agreedById: MANAGER })),
        Story.provide(CoachingActor, personActor(TENANT, COACH, ['coach'])),
        Story.when(engRef, new ProposeEngagement({ coachId: COACH, coacheeId: ADVISOR })),
        Story.call(NotificationGateway.dispatch, {
          tenantId: TENANT,
          recipientId: ADVISOR,
          kind: 'engagement_proposed',
        }),
        Story.succeed(NotificationGateway.dispatch, { queued: true }),
        Story.then(
          engRef,
          new EngagementProposed({ tenantId: TENANT, coachId: COACH, coacheeId: ADVISOR }),
        ),
        Story.provide(CoachingActor, personActor(TENANT, ADVISOR)),
        Story.when(engRef, new AcceptEngagement({ coachGrantActive: true })),
        Story.then(engRef, new EngagementAccepted({})),
      );
    },
  );
});
