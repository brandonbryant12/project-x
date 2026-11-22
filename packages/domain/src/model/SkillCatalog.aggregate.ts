import * as Domain from '@alchemy.run/domain';
import { Effect, Schema } from 'effect';
import { SkillResource } from '../catalog.ts';
import { SkillTier } from '../scoring/catalog-insights.ts';
import { SkillId, TenantId } from '../ids.ts';
import { SkillDomain } from '../vocabulary.ts';
import { CoachingActor, CoachingSession } from './CoachingActor.context.ts';
import {
  AlreadyExists,
  InvalidDomainInput,
  NotFoundInDomain,
  SkillLevelFact,
  SkillMetadataFact,
  UnauthorizedActor,
} from './Shared.ts';

export class SkillPublished extends Domain.Event('SkillPublished', {
  tenantId: TenantId,
  ...SkillMetadataFact,
  version: Schema.Int,
  levels: Schema.Array(SkillLevelFact),
}) {}

export class SkillVersionPublished extends Domain.Event('SkillVersionPublished', {
  tenantId: TenantId,
  ...SkillMetadataFact,
  version: Schema.Int,
  levels: Schema.Array(SkillLevelFact),
  changeNote: Schema.String,
}) {}

export class PlaybookResourceAttached extends Domain.Event('PlaybookResourceAttached', {
  tenantId: TenantId,
  resource: SkillResource,
}) {}

export class PlaybookResourceRemoved extends Domain.Event('PlaybookResourceRemoved', {
  tenantId: TenantId,
  resourceId: Schema.String,
}) {}

export class SkillRetired extends Domain.Event('SkillRetired', {
  tenantId: TenantId,
}) {}

export class PublishSkill extends Domain.Command(
  'PublishSkill',
  {
    target: SkillId,
    middleware: [CoachingSession],
    input: {
      ...SkillMetadataFact,
      levels: Schema.Array(SkillLevelFact),
    },
    events: [SkillPublished],
    rejects: [AlreadyExists, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Publish a new firm skill (v1) to the Skill Catalog.' },
) {}

export class PublishSkillVersion extends Domain.Command(
  'PublishSkillVersion',
  {
    target: SkillId,
    middleware: [CoachingSession],
    input: {
      ...SkillMetadataFact,
      levels: Schema.Array(SkillLevelFact),
      changeNote: Schema.String,
    },
    events: [SkillVersionPublished],
    rejects: [NotFoundInDomain, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Publish an updated immutable version (vN+1) of an existing skill.' },
) {}

export class AttachPlaybookResource extends Domain.Command(
  'AttachPlaybookResource',
  {
    target: SkillId,
    middleware: [CoachingSession],
    input: { resource: SkillResource },
    events: [PlaybookResourceAttached],
    rejects: [NotFoundInDomain, UnauthorizedActor, InvalidDomainInput],
  },
  { description: 'Attach a custom level-up playbook, script, or guide to a skill level.' },
) {}

export class RemovePlaybookResource extends Domain.Command(
  'RemovePlaybookResource',
  {
    target: SkillId,
    middleware: [CoachingSession],
    input: { resourceId: Schema.String },
    events: [PlaybookResourceRemoved],
    rejects: [NotFoundInDomain, UnauthorizedActor],
  },
  { description: 'Remove a level-up playbook resource from a skill.' },
) {}

export class RetireSkill extends Domain.Command(
  'RetireSkill',
  {
    target: SkillId,
    middleware: [CoachingSession],
    input: {},
    events: [SkillRetired],
    rejects: [NotFoundInDomain, UnauthorizedActor],
  },
  { description: 'Retire a skill from active catalog discovery while preserving historical data.' },
) {}

export const SkillCatalogState = Schema.Union([
  Schema.TaggedStruct('Uncreated', {}),
  Schema.TaggedStruct('Published', {
    tenantId: TenantId,
    slug: Schema.String,
    name: Schema.String,
    domain: SkillDomain,
    tier: SkillTier,
    version: Schema.Int,
    retired: Schema.Boolean,
    resources: Schema.Array(SkillResource),
  }),
]);
export type SkillCatalogState = typeof SkillCatalogState.Type;

const validateFourLevels = (levels: ReadonlyArray<SkillLevelFact>): InvalidDomainInput | null => {
  const seen = new Set(levels.map((l) => l.level));
  if (levels.length !== 4 || ![1, 2, 3, 4].every((n) => seen.has(n as 1 | 2 | 3 | 4))) {
    return new InvalidDomainInput({
      field: 'levels',
      reason: 'Provide definitions for all four levels (1–4).',
    });
  }
  if (levels.some((l) => l.summary.trim().length < 3 || l.indicators.length === 0)) {
    return new InvalidDomainInput({
      field: 'levels',
      reason: 'Each level needs a summary and at least one observable indicator.',
    });
  }
  return null;
};

export class SkillCatalog extends Domain.Aggregate(
  'SkillCatalog',
  {
    id: SkillId,
    state: SkillCatalogState,
    initial: { _tag: 'Uncreated' },
    commands: [
      PublishSkill,
      PublishSkillVersion,
      AttachPlaybookResource,
      RemovePlaybookResource,
      RetireSkill,
    ],
    decide: {
      PublishSkill: Effect.fn(function* (state, cmd, ctx) {
        if (state._tag !== 'Uncreated') {
          return yield* new AlreadyExists({ entity: 'SkillCatalog', id: ctx.id });
        }
        const actor = yield* CoachingActor;
        if (
          actor.kind === 'person' &&
          !actor.grants.includes('tenant_admin') &&
          !actor.grants.includes('program_owner')
        ) {
          return yield* new UnauthorizedActor({
            action: 'PublishSkill',
            reason: 'Only tenant admins or program owners can author skills.',
          });
        }
        const err = validateFourLevels(cmd.levels);
        if (err) return yield* err;
        return [
          new SkillPublished({
            tenantId: actor.tenantId,
            slug: cmd.slug,
            name: cmd.name.trim(),
            domain: cmd.domain,
            tier: cmd.tier,
            summary: cmd.summary.trim(),
            outcome: cmd.outcome.trim(),
            tags: cmd.tags,
            version: 1,
            levels: cmd.levels,
          }),
        ];
      }),
      PublishSkillVersion: Effect.fn(function* (state, cmd, ctx) {
        if (state._tag !== 'Published') {
          return yield* new NotFoundInDomain({ entity: 'SkillCatalog', id: ctx.id });
        }
        const actor = yield* CoachingActor;
        if (
          actor.kind === 'person' &&
          !actor.grants.includes('tenant_admin') &&
          !actor.grants.includes('program_owner')
        ) {
          return yield* new UnauthorizedActor({
            action: 'PublishSkillVersion',
            reason: 'Only tenant admins or program owners can edit skills.',
          });
        }
        const err = validateFourLevels(cmd.levels);
        if (err) return yield* err;
        return [
          new SkillVersionPublished({
            tenantId: state.tenantId,
            slug: cmd.slug,
            name: cmd.name.trim(),
            domain: cmd.domain,
            tier: cmd.tier,
            summary: cmd.summary.trim(),
            outcome: cmd.outcome.trim(),
            tags: cmd.tags,
            version: state.version + 1,
            levels: cmd.levels,
            changeNote: cmd.changeNote.trim() || 'Updated in Skill Catalog Studio',
          }),
        ];
      }),
      AttachPlaybookResource: Effect.fn(function* (state, cmd, ctx) {
        if (state._tag !== 'Published') {
          return yield* new NotFoundInDomain({ entity: 'SkillCatalog', id: ctx.id });
        }
        const actor = yield* CoachingActor;
        const allowed =
          actor.kind === 'system' ||
          actor.grants.includes('tenant_admin') ||
          actor.grants.includes('program_owner') ||
          actor.grants.includes('coach');
        if (!allowed) {
          return yield* new UnauthorizedActor({
            action: 'AttachPlaybookResource',
            reason: 'Only coaches, program owners, or tenant admins can add playbook resources.',
          });
        }
        if (cmd.resource.title.trim().length < 2) {
          return yield* new InvalidDomainInput({
            field: 'title',
            reason: 'Resource title must be at least 2 characters.',
          });
        }
        return [new PlaybookResourceAttached({ tenantId: state.tenantId, resource: cmd.resource })];
      }),
      RemovePlaybookResource: Effect.fn(function* (state, cmd, ctx) {
        if (state._tag !== 'Published') {
          return yield* new NotFoundInDomain({ entity: 'SkillCatalog', id: ctx.id });
        }
        const actor = yield* CoachingActor;
        const allowed =
          actor.kind === 'system' ||
          actor.grants.includes('tenant_admin') ||
          actor.grants.includes('program_owner') ||
          actor.grants.includes('coach');
        if (!allowed) {
          return yield* new UnauthorizedActor({
            action: 'RemovePlaybookResource',
            reason: 'Only coaches, program owners, or tenant admins can remove playbook resources.',
          });
        }
        if (!state.resources.some((r) => r.id === cmd.resourceId)) return [];
        return [
          new PlaybookResourceRemoved({ tenantId: state.tenantId, resourceId: cmd.resourceId }),
        ];
      }),
      RetireSkill: Effect.fn(function* (state, _cmd, ctx) {
        if (state._tag !== 'Published') {
          return yield* new NotFoundInDomain({ entity: 'SkillCatalog', id: ctx.id });
        }
        const actor = yield* CoachingActor;
        if (
          actor.kind === 'person' &&
          !actor.grants.includes('tenant_admin') &&
          !actor.grants.includes('program_owner')
        ) {
          return yield* new UnauthorizedActor({
            action: 'RetireSkill',
            reason: 'Only tenant admins or program owners can retire skills.',
          });
        }
        if (state.retired) return [];
        return [new SkillRetired({ tenantId: state.tenantId })];
      }),
    },
    evolve: {
      SkillPublished: (_state, e) => ({
        _tag: 'Published' as const,
        tenantId: e.tenantId,
        slug: e.slug,
        name: e.name,
        domain: e.domain,
        tier: e.tier,
        version: e.version,
        retired: false,
        resources: [],
      }),
      SkillVersionPublished: (state, e) =>
        state._tag === 'Published'
          ? {
              ...state,
              slug: e.slug,
              name: e.name,
              domain: e.domain,
              tier: e.tier,
              version: e.version,
            }
          : state,
      PlaybookResourceAttached: (state, e) =>
        state._tag === 'Published'
          ? { ...state, resources: [...state.resources, e.resource] }
          : state,
      PlaybookResourceRemoved: (state, e) =>
        state._tag === 'Published'
          ? { ...state, resources: state.resources.filter((r) => r.id !== e.resourceId) }
          : state,
      SkillRetired: (state) => (state._tag === 'Published' ? { ...state, retired: true } : state),
    },
  },
  { description: 'Immutable versioned skill definitions and level-up playbook resources.' },
) {}
