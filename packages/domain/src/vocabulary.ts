import { Schema } from 'effect';

/**
 * Closed vocabularies shared by the database, API and UI.
 * One `as const` array per vocabulary; the Schema and the type derive from it.
 * See CONTEXT.md for meanings.
 */

export const GRANT_ROLES = [
  'coach',
  'catalog_keeper',
  'tenant_admin',
  'compliance_reviewer',
  /** Sees aggregate adoption only, never names (ADR 0021). */
  'program_owner',
] as const;
export const GrantRole = Schema.Literals(GRANT_ROLES);
export type GrantRole = typeof GrantRole.Type;

/** Entra app-role values → grants. App roles are configured on the enterprise app. */
export const ENTRA_APP_ROLE_TO_GRANT: Readonly<Record<string, GrantRole>> = {
  Coach: 'coach',
  CatalogKeeper: 'catalog_keeper',
  TenantAdmin: 'tenant_admin',
  ComplianceReviewer: 'compliance_reviewer',
  ProgramOwner: 'program_owner',
};

export const LEVELS = [1, 2, 3, 4] as const;
export const Level = Schema.Literals(LEVELS);
export type Level = typeof Level.Type;

export const LEVEL_NAMES: Readonly<Record<Level, string>> = {
  1: 'Learning',
  2: 'Doing with support',
  3: 'Doing independently',
  4: 'Teaching others',
};

/**
 * Badges are auto-awarded for levels 2-3. "Learning" is a starting point, and
 * "Teaching others" cannot be shown in a client meeting: it will be earned by
 * observing and developing others (designed, not yet built — see
 * docs/product/domain-model.md § Teaching others).
 */
export const BADGE_LEVELS = [2, 3] as const satisfies ReadonlyArray<Level>;
export type BadgeLevel = (typeof BADGE_LEVELS)[number];

/**
 * How the observer knows. Named honestly (red-team 2026-11-16): only `saw_it`
 * and `reviewed_work` are first-hand; `discussed` is the coachee's account,
 * and badge criteria cap how much of it can count.
 */
export const OBSERVATION_MODES = ['saw_it', 'reviewed_work', 'discussed'] as const;
export const ObservationMode = Schema.Literals(OBSERVATION_MODES);
export type ObservationMode = typeof ObservationMode.Type;

export const OBSERVATION_MODE_LABELS: Readonly<Record<ObservationMode, string>> = {
  saw_it: 'I saw it',
  reviewed_work: 'I reviewed the work',
  discussed: 'We discussed it',
};

export const isFirstHand = (mode: ObservationMode): boolean => mode !== 'discussed';

/** Why an observer is eligible. `designated`: named by the subject's leader or coach (ADR 0020). */
export const OBSERVER_BASES = ['leader', 'coach', 'designated'] as const;
export const ObserverBasis = Schema.Literals(OBSERVER_BASES);
export type ObserverBasis = typeof ObserverBasis.Type;

export const INTERACTION_KINDS = [
  'client_meeting',
  'book_review',
  'team_conversation',
  'prospect_meeting',
  'presentation',
  'other',
] as const;
export const InteractionKind = Schema.Literals(INTERACTION_KINDS);
export type InteractionKind = typeof InteractionKind.Type;

export const INTERACTION_KIND_LABELS: Readonly<Record<InteractionKind, string>> = {
  client_meeting: 'Client meeting',
  book_review: 'Book review',
  team_conversation: 'Team conversation',
  prospect_meeting: 'Prospect meeting',
  presentation: 'Presentation',
  other: 'Other work',
};

export const SKILL_DOMAINS = [
  'client_discovery',
  'planning_advice',
  'behavioral_coaching',
  'trust_integrity',
  'communication',
  'relationship_growth',
  'leadership',
] as const;
export const SkillDomain = Schema.Literals(SKILL_DOMAINS);
export type SkillDomain = typeof SkillDomain.Type;

export const SKILL_DOMAIN_LABELS: Readonly<Record<SkillDomain, string>> = {
  client_discovery: 'Client discovery',
  planning_advice: 'Planning & advice',
  behavioral_coaching: 'Behavioral coaching',
  trust_integrity: 'Trust & integrity',
  communication: 'Communication',
  relationship_growth: 'Relationship growth',
  leadership: 'Leadership',
};

export const ACTIVITY_ORIGINS = ['planned', 'ad_hoc'] as const;
export const ActivityOrigin = Schema.Literals(ACTIVITY_ORIGINS);
export type ActivityOrigin = typeof ActivityOrigin.Type;

export const PERSON_STATUSES = ['active', 'on_leave', 'departed'] as const;
export const PersonStatus = Schema.Literals(PERSON_STATUSES);
export type PersonStatus = typeof PersonStatus.Type;

export const ADVISORY_DISPOSITIONS = ['agreed', 'overrode', 'ignored'] as const;
export const AdvisoryDisposition = Schema.Literals(ADVISORY_DISPOSITIONS);
export type AdvisoryDisposition = typeof AdvisoryDisposition.Type;

/** Only the privacy screen runs; the nudge sets are parked with ADR 0016 (deferred). */
export const QUESTION_SETS = ['privacy-screen'] as const;
export const QuestionSetId = Schema.Literals(QUESTION_SETS);
export type QuestionSetId = typeof QuestionSetId.Type;

/** A designation lasts at most this long (ADR 0020). */
export const MAX_DESIGNATION_DAYS = 90;

/** The capacity a skill profile applies to (ADR 0017). Only `core` profiles exist today. */
export const PROFILE_CAPACITIES = ['any', 'leader', 'coach', 'job_family'] as const;
export const CORE_PROFILE = 'core';

/**
 * Notifications (ADR 0018). The kinds are a closed set; a message carries
 * names, counts, dates and a link only (invariant I20).
 */
export const NOTIFICATION_KINDS = [
  'observation_requested',
  'observation_signed',
  'observation_returned',
  'plan_proposed',
  'engagement_proposed',
  'request_expiring',
  'weekly_digest',
] as const;
export const NotificationKind = Schema.Literals(NOTIFICATION_KINDS);
export type NotificationKind = typeof NotificationKind.Type;

export const NOTIFICATION_ENTITY_TYPES = ['observation', 'plan', 'engagement', 'digest'] as const;
export const NOTIFICATION_STATUSES = ['pending', 'sent', 'skipped', 'failed'] as const;
export const NOTIFICATION_CHANNELS = ['email', 'teams', 'off'] as const;
export const NotificationChannel = Schema.Literals(NOTIFICATION_CHANNELS);
export type NotificationChannel = typeof NotificationChannel.Type;
/** How many people an observer is happy to observe in a week (who-to-observe). */
export const DEFAULT_OBSERVE_CAPACITY = 2;

/**
 * Directory exceptions (ADR 0006): HR data that breaks a structural rule or
 * cannot be applied. The import records them for a tenant admin and never
 * fails on them, because HR is the source of truth.
 */
export const DIRECTORY_EXCEPTION_KINDS = [
  'coach_reports_to_coach',
  'manager_not_found',
  'cycle',
  'self_manager',
  'duplicate_email',
  'manager_departed',
  'invalid_row',
  'self_departure',
] as const;
export const DirectoryExceptionKind = Schema.Literals(DIRECTORY_EXCEPTION_KINDS);
export type DirectoryExceptionKind = typeof DirectoryExceptionKind.Type;
