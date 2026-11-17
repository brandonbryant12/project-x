import {
  ActivityTemplateId,
  CatalogItemLifecycle,
  InteractionKind,
  Level,
  SkillDomain,
  SkillId,
  SkillLevelDefinition,
  SkillRole,
} from '@repo/domain';
import { Schema } from 'effect';
import { Instant, PersonSummary, SkillRef } from './common.ts';

/**
 * Program administration (design 2026-11-17 §7): the tenant's credit rules and
 * the catalog, changed at run time by program owners and tenant admins. Every
 * write names the version its editor loaded, so a stale editor gets Conflict.
 */

const CatalogItemStatus = CatalogItemLifecycle.Status;
export const CatalogItemEventType = Schema.Literals(['PUBLISH', 'RETIRE', 'DISCARD']);
export type CatalogItemEventType = typeof CatalogItemEventType.Type;

/** Every field of a credit policy except its version: what a save sends. */
export const CreditPolicyValues = Schema.Struct({
  primaryPoints: Schema.Number,
  secondaryPoints: Schema.Number,
  badgePoints: Schema.Number,
  minInteractions: Schema.Number,
  minObservers: Schema.Number,
  minFirstHandShare: Schema.Number,
  minSpanDays: Schema.Number,
  minPrimaryPoints: Schema.Number,
  maxSkillsPerObservation: Schema.Number,
  activityOverrides: Schema.Struct({
    enabled: Schema.Boolean,
    minPoints: Schema.Number,
    maxPoints: Schema.Number,
  }),
});
export type CreditPolicyValues = typeof CreditPolicyValues.Type;

const Stored = Schema.NullOr(Schema.Number);
/** The stored policy as it is, which may be broken: a missing or mistyped field reads as null. */
export const StoredCreditPolicy = Schema.Struct({
  primaryPoints: Stored,
  secondaryPoints: Stored,
  badgePoints: Stored,
  minInteractions: Stored,
  minObservers: Stored,
  minFirstHandShare: Stored,
  minSpanDays: Stored,
  minPrimaryPoints: Stored,
  maxSkillsPerObservation: Stored,
  activityOverrides: Schema.Struct({
    enabled: Schema.NullOr(Schema.Boolean),
    minPoints: Stored,
    maxPoints: Stored,
  }),
});
export type StoredCreditPolicy = typeof StoredCreditPolicy.Type;

export const PolicyProblemView = Schema.Struct({ field: Schema.String, message: Schema.String });
export type PolicyProblemView = typeof PolicyProblemView.Type;

const ChangedValue = Schema.NullOr(Schema.Union([Schema.String, Schema.Number, Schema.Boolean]));

/** One audited change: a policy save or a catalog edit, with who, when, why and each field before and after. */
export const ChangeView = Schema.Struct({
  id: Schema.String,
  at: Instant,
  actor: Schema.NullOr(PersonSummary),
  event: Schema.String,
  reason: Schema.NullOr(Schema.String),
  changes: Schema.Array(
    Schema.Struct({ field: Schema.String, before: ChangedValue, after: ChangedValue }),
  ),
});
export type ChangeView = typeof ChangeView.Type;

export const CreditPolicyAdminView = Schema.Struct({
  /** The version a save must name: the stored one, or 0 when the stored policy has none. */
  version: Schema.Number,
  valid: Schema.Boolean,
  stored: StoredCreditPolicy,
  /** Empty when valid. A broken policy stops signing until it is saved again. */
  problems: Schema.Array(PolicyProblemView),
  /** The working defaults, for comparison only: a stored policy never falls back to them. */
  defaults: CreditPolicyValues,
  /** Saved changes, newest first. */
  history: Schema.Array(ChangeView),
});
export type CreditPolicyAdminView = typeof CreditPolicyAdminView.Type;

export const SaveCreditPolicyInput = Schema.Struct({
  expectedVersion: Schema.Number,
  policy: CreditPolicyValues,
  /** At least 10 characters; stored as a purgeable note on the audit event. */
  reason: Schema.String.pipe(Schema.check(Schema.isMaxLength(1000))),
});
export type SaveCreditPolicyInput = typeof SaveCreditPolicyInput.Type;

/** A skill's own values; null uses the tenant's. */
export const SkillValuesView = Schema.Struct({
  primaryPoints: Schema.NullOr(Schema.Number),
  secondaryPoints: Schema.NullOr(Schema.Number),
  badgePoints: Schema.NullOr(Schema.Number),
  minPrimaryPoints: Schema.NullOr(Schema.Number),
});
export type SkillValuesView = typeof SkillValuesView.Type;

/** The tenant's values a skill falls back to (null while the stored policy is broken). */
export const TenantValuesView = Schema.NullOr(
  Schema.Struct({
    primaryPoints: Schema.Number,
    secondaryPoints: Schema.Number,
    badgePoints: Schema.Number,
    minPrimaryPoints: Schema.Number,
  }),
);
export type TenantValuesView = typeof TenantValuesView.Type;

export const ProgramSkillRow = Schema.Struct({
  ...SkillRef.fields,
  summary: Schema.String,
  status: CatalogItemStatus,
  /** The row's edit version, named by every write. */
  version: Schema.Number,
  /** The published version number observers see, or null before the first publication. */
  currentVersion: Schema.NullOr(Schema.Number),
  /** There are saved changes to the definition that are not published yet. */
  hasDraft: Schema.Boolean,
  values: SkillValuesView,
  updatedAt: Instant,
});
export type ProgramSkillRow = typeof ProgramSkillRow.Type;

export const ProgramSkillList = Schema.Struct({
  tenantValues: TenantValuesView,
  skills: Schema.Array(ProgramSkillRow),
});
export type ProgramSkillList = typeof ProgramSkillList.Type;

/** A level in an editor: indicators carried over keep their lineage key. */
export const LevelDraftView = Schema.Struct({
  level: Level,
  summary: Schema.String,
  indicators: Schema.Array(Schema.Struct({ lineageKey: Schema.String, text: Schema.String })),
});
export type LevelDraftView = typeof LevelDraftView.Type;

export const ProgramSkillDetail = Schema.Struct({
  ...ProgramSkillRow.fields,
  outcome: Schema.String,
  tags: Schema.Array(Schema.String),
  /** Unpublished changes, or null when the definition is the published one. */
  draft: Schema.NullOr(Schema.Array(LevelDraftView)),
  /** The draft can be published: four levels, each with a summary and an indicator. */
  draftComplete: Schema.Boolean,
  /** The current published version's levels; empty before the first publication. */
  published: Schema.Array(SkillLevelDefinition),
  versions: Schema.Array(
    Schema.Struct({
      number: Schema.Number,
      publishedAt: Instant,
      publishedBy: Schema.NullOr(PersonSummary),
      changeNote: Schema.NullOr(Schema.String),
    }),
  ),
  tenantValues: TenantValuesView,
  /** Templates (not discarded) that list this skill. */
  templates: Schema.Array(
    Schema.Struct({ id: ActivityTemplateId, name: Schema.String, status: CatalogItemStatus }),
  ),
  /** Lifecycle events the viewer may send now. */
  actions: Schema.Array(CatalogItemEventType),
  /** The viewer may edit its details, draft definition and values. */
  canEdit: Schema.Boolean,
  history: Schema.Array(ChangeView),
});
export type ProgramSkillDetail = typeof ProgramSkillDetail.Type;

const Name = Schema.String.pipe(Schema.check(Schema.isMaxLength(120)));
const Text = Schema.String.pipe(Schema.check(Schema.isMaxLength(600)));

export const SkillDetailsInput = Schema.Struct({
  name: Name,
  summary: Text,
  domain: SkillDomain,
  outcome: Name,
  tags: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMaxLength(40)))),
});
export type SkillDetailsInput = typeof SkillDetailsInput.Type;

export const LevelDraftInput = Schema.Struct({
  level: Level,
  summary: Schema.String,
  indicators: Schema.Array(
    Schema.Struct({ lineageKey: Schema.NullOr(Schema.String), text: Schema.String }),
  ),
});
export type LevelDraftInput = typeof LevelDraftInput.Type;

export const UpdateSkillInput = Schema.Struct({
  ...SkillDetailsInput.fields,
  version: Schema.Number,
  /** The whole draft definition; null keeps the published definition with no pending changes. */
  definition: Schema.NullOr(Schema.Array(LevelDraftInput)),
});
export type UpdateSkillInput = typeof UpdateSkillInput.Type;

export const SetSkillValuesInput = Schema.Struct({
  version: Schema.Number,
  values: SkillValuesView,
  reason: Schema.String.pipe(Schema.check(Schema.isMaxLength(1000))),
});
export type SetSkillValuesInput = typeof SetSkillValuesInput.Type;

export const CatalogTransitionInput = Schema.Struct({
  version: Schema.Number,
  event: CatalogItemEventType,
  /** For PUBLISH, the version's change note; otherwise an optional reason for the record. */
  note: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(600)))),
});
export type CatalogTransitionInput = typeof CatalogTransitionInput.Type;

export const ProgramTemplateSkill = Schema.Struct({
  skill: SkillRef,
  /** A retired or unpublished skill must be removed before the template can be saved. */
  skillStatus: CatalogItemStatus,
  role: SkillRole,
  points: Schema.NullOr(Schema.Number),
});
export type ProgramTemplateSkill = typeof ProgramTemplateSkill.Type;

export const ProgramTemplateRow = Schema.Struct({
  id: ActivityTemplateId,
  slug: Schema.String,
  name: Schema.String,
  kind: InteractionKind,
  status: CatalogItemStatus,
  version: Schema.Number,
  skills: Schema.Array(ProgramTemplateSkill),
  typicalMinutes: Schema.NullOr(Schema.Number),
  updatedAt: Instant,
});
export type ProgramTemplateRow = typeof ProgramTemplateRow.Type;

export const ProgramTemplateDetail = Schema.Struct({
  ...ProgramTemplateRow.fields,
  description: Schema.String,
  observationTip: Schema.NullOr(Schema.String),
  actions: Schema.Array(CatalogItemEventType),
  canEdit: Schema.Boolean,
  history: Schema.Array(ChangeView),
});
export type ProgramTemplateDetail = typeof ProgramTemplateDetail.Type;

export const TemplateInput = Schema.Struct({
  name: Name,
  description: Text,
  kind: InteractionKind,
  observationTip: Schema.NullOr(Text),
  typicalMinutes: Schema.NullOr(Schema.Number),
  skills: Schema.Array(
    Schema.Struct({ skillId: SkillId, role: SkillRole, points: Schema.NullOr(Schema.Number) }),
  ),
});
export type TemplateInput = typeof TemplateInput.Type;

export const UpdateTemplateInput = Schema.Struct({
  ...TemplateInput.fields,
  version: Schema.Number,
});
export type UpdateTemplateInput = typeof UpdateTemplateInput.Type;
