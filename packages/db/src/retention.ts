/**
 * Retention classes (ADR 0012, controls C1.1/C1.2). Every table has a class,
 * and every free-text column is classified, so a new column cannot slip in
 * without a decision about how long it lives. `retention.test.ts` enforces it.
 *
 * The periods are PROVISIONAL defaults pending compliance sign-off
 * (docs/product/domain-expert-questions.md D2). Purge jobs are planned, not
 * built; purge columns (`purged_at`, nullable bodies) and `legal_hold` exist.
 */
export const RETENTION_CLASSES = {
  /** Facts the firm may need to evidence: who observed whom, when, at what level. */
  record: { keep: 'P7Y after the person departs', purge: 'never while a legal hold applies' },
  /** User-written words. Purgeable earlier than the facts they sit on. */
  narrative: {
    keep: 'P3Y after it was written, or on request',
    purge: 'null the body, keep the digest',
  },
  /** Append-only evidence of actions and AI decisions. */
  audit: { keep: 'P7Y', purge: 'never while a legal hold applies' },
  /** Mirror of the HR directory. */
  directory: { keep: 'while employed, then P1Y', purge: 'anonymise the person row' },
  /** Catalog and configuration, versioned; referenced by records. */
  reference: { keep: 'indefinitely', purge: 'retire, never delete' },
  /** Plumbing: sessions, the notification outbox, preferences. */
  operational: { keep: 'P90D after last use', purge: 'delete' },
} as const;

export type RetentionClass = keyof typeof RETENTION_CLASSES;

export const TABLE_RETENTION: Readonly<Record<string, RetentionClass>> = {
  tenant: 'reference',
  business_function: 'reference',
  job_family: 'reference',
  person: 'directory',
  person_position: 'directory',
  reporting_line: 'directory',
  role_grant: 'directory',
  directory_exception: 'directory',
  session: 'operational',
  notification_preference: 'operational',
  notification: 'operational',
  skill: 'reference',
  skill_version: 'reference',
  skill_level: 'reference',
  skill_indicator: 'reference',
  skill_profile: 'reference',
  activity_template: 'reference',
  activity_template_skill: 'reference',
  engagement: 'record',
  observer_designation: 'record',
  plan: 'record',
  plan_skill: 'record',
  activity: 'record',
  activity_skill: 'record',
  interaction: 'record',
  evidence: 'narrative',
  observation: 'record',
  observation_rating: 'record',
  observation_indicator: 'record',
  credit_entry: 'record',
  credit_reversal: 'record',
  badge_award: 'record',
  badge_award_credit: 'record',
  badge_waiver: 'record',
  coaching_conversation: 'record',
  commitment: 'record',
  note: 'narrative',
  legal_hold: 'audit',
  audit_event: 'audit',
  advisory_check: 'audit',
  advisory_exposure: 'audit',
  advisory_label: 'audit',
  advisory_disposition: 'audit',
  advisory_question_snapshot: 'audit',
  question_set_release: 'audit',
  second_read: 'audit',
  second_read_rating: 'audit',
};

/** User-written words: retention class `narrative` regardless of their table's class. */
export const NARRATIVE_COLUMNS: Readonly<Record<string, ReadonlyArray<string>>> = {
  engagement: ['note'],
  plan: ['title', 'intent', 'closing_summary'],
  activity: ['title', 'description'],
  evidence: ['body'],
  observation: ['narrative_saw', 'narrative_next'],
  note: ['body'],
  commitment: ['body'],
  /** Model output can echo the text it read. */
  advisory_check: ['rationale'],
};

/** Human-readable reference text written by HR or catalog keepers, never about clients. */
export const LABEL_COLUMNS: Readonly<Record<string, ReadonlyArray<string>>> = {
  tenant: ['name'],
  business_function: ['name'],
  job_family: ['name'],
  person: ['display_name', 'title', 'location'],
  person_position: ['title'],
  activity_template: ['name', 'description', 'observation_tip'],
  skill: ['name', 'summary', 'tags'],
  skill_level: ['summary'],
  skill_indicator: ['text'],
  skill_profile: ['name'],
  skill_version: ['change_note'],
  question_set_release: ['dataset_ref', 'experiment_ref', 'approved_by', 'notes'],
};

/** Text that holds a code from a closed set or an opaque reference, not prose. */
export const CODED_COLUMNS: Readonly<Record<string, ReadonlyArray<string>>> = {
  observer_designation: ['designator_basis'],
  activity: ['intended_mode'],
  evidence: ['hold_reason'],
  interaction: ['client_ref'],
  advisory_check: ['provider', 'failure'],
  advisory_disposition: ['disposition'],
  advisory_label: ['label_value', 'strength', 'labeler_role'],
  advisory_question_snapshot: ['digest'],
  second_read: ['assigned_reason'],
  audit_event: ['auth_method', 'from_state', 'to_state'],
};

/** Column names that are structured by convention (ids, codes, states, digests). */
export const STRUCTURED_COLUMN_NAME =
  /(^id$|_id$|^status$|^kind$|^mode$|^basis$|_code$|^slug$|^source$|^key$|_key$|^role$|^channel$|^method$|^level$|^arm$|^effect$|_digest$|_hash$|^event$|^entity_type$|^subject_type$|^capacity$|^criterion$|^domain$|^outcome$|^time_zone$|^email$|_version$|^question_set$|^model$|_type$|^origin$|^answer$|^question_id$)/;
