import * as Domain from '@alchemy.run/domain';
import { Effect, Schema } from 'effect';
import { SkillTier } from '../scoring/catalog-insights.ts';
import { ObservationId, PersonId, SkillId, TenantId } from '../ids.ts';
import { ObservationLifecycle } from '../lifecycles/observation.ts';
import { BADGE_LEVELS, SkillDomain } from '../vocabulary.ts';
import { CoachingActor, CoachingSession } from './CoachingActor.context.ts';
import { Observation } from './Observation.aggregate.ts';
import { personMasteryKey, PersonMasteryKey, UnauthorizedActor } from './Shared.ts';
import { SkillCatalog } from './SkillCatalog.aggregate.ts';
import { SkillLedger } from './SkillLedger.aggregate.ts';

/* ── PersonMasteryView: live per-(tenant, person) mastery standing ── */

const SkillStandingEntry = Schema.Struct({
  skillId: SkillId,
  netDemonstrations: Schema.Int,
  heldBadges: Schema.Array(Schema.Literals(BADGE_LEVELS)),
});

export const PersonMasteryState = Schema.Struct({
  tenantId: Schema.NullOr(TenantId),
  personId: Schema.NullOr(PersonId),
  skills: Schema.Array(SkillStandingEntry),
});
export type PersonMasteryState = typeof PersonMasteryState.Type;

const upsertSkillStanding = (
  skills: ReadonlyArray<typeof SkillStandingEntry.Type>,
  skillId: SkillId,
  update: (cur: typeof SkillStandingEntry.Type) => typeof SkillStandingEntry.Type,
): Array<typeof SkillStandingEntry.Type> => {
  const existing = skills.find((s) => s.skillId === skillId) ?? {
    skillId,
    netDemonstrations: 0,
    heldBadges: [],
  };
  const next = update(existing);
  const rest = skills.filter((s) => s.skillId !== skillId);
  return [...rest, next].toSorted((a, b) => a.skillId.localeCompare(b.skillId));
};

export class PersonMasteryView extends Domain.View(
  'PersonMasteryView',
  {
    from: [SkillLedger],
    key: PersonMasteryKey,
    middleware: [CoachingSession],
    rejects: [UnauthorizedActor],
    state: PersonMasteryState,
    initial: { tenantId: null, personId: null, skills: [] },
    keyOf: {
      SkillLedger: ({ event }) => personMasteryKey(event.tenantId, event.personId),
    },
    evolve: {
      DemonstrationRecorded: (state, e) => ({
        tenantId: e.tenantId,
        personId: e.personId,
        skills: upsertSkillStanding(state.skills, e.skillId, (cur) => ({
          ...cur,
          netDemonstrations: cur.netDemonstrations + 1,
        })),
      }),
      DemonstrationReversed: (state, e) => ({
        tenantId: e.tenantId,
        personId: e.personId,
        skills: upsertSkillStanding(state.skills, e.skillId, (cur) => ({
          ...cur,
          netDemonstrations: Math.max(0, cur.netDemonstrations - 1),
        })),
      }),
      BadgeAwarded: (state, e) => ({
        tenantId: e.tenantId,
        personId: e.personId,
        skills: upsertSkillStanding(state.skills, e.skillId, (cur) => ({
          ...cur,
          heldBadges: cur.heldBadges.includes(e.level)
            ? cur.heldBadges
            : [...cur.heldBadges, e.level].toSorted((a, b) => a - b),
        })),
      }),
      BadgeRevoked: (state, e) => ({
        tenantId: e.tenantId,
        personId: e.personId,
        skills: upsertSkillStanding(state.skills, e.skillId, (cur) => ({
          ...cur,
          heldBadges: cur.heldBadges.filter((lvl) => lvl !== e.level),
        })),
      }),
    },
  },
  { description: 'Live per-person skill mastery rings and held badges folded from SkillLedger.' },
) {}

export const PersonMasteryViewLive = PersonMasteryView.toLayer(
  Effect.succeed(
    Effect.fn(function* (request, state) {
      const actor = yield* CoachingActor;
      if (actor.kind === 'system') return;
      const keyTenant = state?.tenantId ?? request.key.split(':')[0];
      if (keyTenant !== actor.tenantId) {
        return yield* new UnauthorizedActor({
          action: 'ReadPersonMasteryView',
          reason: 'Cannot read mastery standing across tenants.',
        });
      }
    }),
  ),
);

/* ── ObservationSummaryView: live per-observation status & emitted milestones ── */

export class ObservationMilestone extends Domain.Event('ObservationMilestone', {
  observationId: ObservationId,
  status: ObservationLifecycle.Status,
  creditedSkillCount: Schema.Int,
}) {}

export const ObservationSummaryState = Schema.Struct({
  tenantId: Schema.NullOr(TenantId),
  subjectId: Schema.NullOr(PersonId),
  observerId: Schema.NullOr(PersonId),
  status: Schema.NullOr(ObservationLifecycle.Status),
  acknowledged: Schema.Boolean,
  creditedSkillCount: Schema.Int,
});
export type ObservationSummaryState = typeof ObservationSummaryState.Type;

export class ObservationSummaryView extends Domain.View(
  'ObservationSummaryView',
  {
    from: [Observation],
    key: Observation,
    middleware: [CoachingSession],
    rejects: [UnauthorizedActor],
    state: ObservationSummaryState,
    initial: {
      tenantId: null,
      subjectId: null,
      observerId: null,
      status: null,
      acknowledged: false,
      creditedSkillCount: 0,
    },
    events: [ObservationMilestone],
    evolve: {
      ObservationRequested: (_s, e) => ({
        tenantId: e.tenantId,
        subjectId: e.subjectId,
        observerId: e.observerId,
        status: 'requested' as const,
        acknowledged: false,
        creditedSkillCount: 0,
      }),
      ObservationStarted: (_s, e) => ({
        tenantId: e.tenantId,
        subjectId: e.subjectId,
        observerId: e.observerId,
        status: 'drafting' as const,
        acknowledged: false,
        creditedSkillCount: 0,
      }),
      ObservationDraftSaved: (s) => ({ ...s, status: 'drafting' as const }),
      ObservationSigned: (s, e) => ({
        ...s,
        status: 'signed' as const,
        creditedSkillCount: e.ratings.filter((r) => r.credit).length,
      }),
      ObservationReturned: (s) => ({ ...s, status: 'returned' as const }),
      ObservationResubmitted: (s) => ({ ...s, status: 'requested' as const }),
      ObservationAcknowledged: (s) => ({ ...s, acknowledged: true }),
      ObservationReviewRequested: (s) => ({ ...s, status: 'under_review' as const }),
      ObservationUpheld: (s) => ({ ...s, status: 'signed' as const }),
      ObservationVoided: (s) => ({ ...s, status: 'voided' as const, creditedSkillCount: 0 }),
      ObservationDeclined: (s) => ({ ...s, status: 'declined' as const }),
      ObservationWithdrawn: (s) => ({ ...s, status: 'withdrawn' as const }),
      ObservationExpired: (s) => ({ ...s, status: 'expired' as const }),
    },
    emit: {
      ObservationSigned: (e, ctx) =>
        new ObservationMilestone({
          observationId: ctx.key.id,
          status: 'signed',
          creditedSkillCount: e.ratings.filter((r) => r.credit).length,
        }),
      ObservationVoided: (_e, ctx) =>
        new ObservationMilestone({
          observationId: ctx.key.id,
          status: 'voided',
          creditedSkillCount: 0,
        }),
    },
  },
  { description: 'Live observation summary view with milestone events.' },
) {}

export const ObservationSummaryViewLive = ObservationSummaryView.toLayer(
  Effect.succeed(
    Effect.fn(function* (_request, state) {
      const actor = yield* CoachingActor;
      if (actor.kind === 'system') return;
      if (state?.tenantId && state.tenantId !== actor.tenantId) {
        return yield* new UnauthorizedActor({
          action: 'ReadObservationSummary',
          reason: 'Cannot read observations across tenants.',
        });
      }
      const isParticipant =
        actor.personId === state?.subjectId || actor.personId === state?.observerId;
      const isPrivileged =
        actor.grants.includes('tenant_admin') || actor.grants.includes('compliance_reviewer');
      if (state?.tenantId && !isParticipant && !isPrivileged) {
        return yield* new UnauthorizedActor({
          action: 'ReadObservationSummary',
          reason:
            'Only participants, compliance reviewers, or tenant admins may view this observation.',
        });
      }
    }),
  ),
);

/* ── TenantCatalogView: live firm skill catalog index ── */

const CatalogEntry = Schema.Struct({
  skillId: SkillId,
  slug: Schema.String,
  name: Schema.String,
  domain: SkillDomain,
  tier: SkillTier,
  version: Schema.Int,
  resourceCount: Schema.Int,
  retired: Schema.Boolean,
});

export const TenantCatalogState = Schema.Struct({
  skills: Schema.Array(CatalogEntry),
});
export type TenantCatalogState = typeof TenantCatalogState.Type;

const upsertCatalog = (
  skills: ReadonlyArray<typeof CatalogEntry.Type>,
  entry: typeof CatalogEntry.Type,
): Array<typeof CatalogEntry.Type> =>
  [...skills.filter((s) => s.skillId !== entry.skillId), entry].toSorted((a, b) =>
    a.slug.localeCompare(b.slug),
  );

export class TenantCatalogView extends Domain.View(
  'TenantCatalogView',
  {
    from: [SkillCatalog],
    key: TenantId,
    state: TenantCatalogState,
    initial: { skills: [] },
    keyOf: {
      SkillCatalog: ({ event }) => event.tenantId,
    },
    evolve: {
      SkillPublished: (state, e, ctx) => ({
        skills: upsertCatalog(state.skills, {
          skillId: ctx.source.id,
          slug: e.slug,
          name: e.name,
          domain: e.domain,
          tier: e.tier,
          version: e.version,
          resourceCount: 0,
          retired: false,
        }),
      }),
      SkillVersionPublished: (state, e, ctx) => {
        const cur = state.skills.find((s) => s.skillId === ctx.source.id);
        return {
          skills: upsertCatalog(state.skills, {
            skillId: ctx.source.id,
            slug: e.slug,
            name: e.name,
            domain: e.domain,
            tier: e.tier,
            version: e.version,
            resourceCount: cur?.resourceCount ?? 0,
            retired: cur?.retired ?? false,
          }),
        };
      },
      PlaybookResourceAttached: (state, _e, ctx) => ({
        skills: state.skills.map((s) =>
          s.skillId === ctx.source.id ? { ...s, resourceCount: s.resourceCount + 1 } : s,
        ),
      }),
      PlaybookResourceRemoved: (state, _e, ctx) => ({
        skills: state.skills.map((s) =>
          s.skillId === ctx.source.id
            ? { ...s, resourceCount: Math.max(0, s.resourceCount - 1) }
            : s,
        ),
      }),
      SkillRetired: (state, _e, ctx) => ({
        skills: state.skills.map((s) =>
          s.skillId === ctx.source.id ? { ...s, retired: true } : s,
        ),
      }),
    },
  },
  { description: 'Live firm skill catalog index folded from SkillCatalog authoring events.' },
) {}
