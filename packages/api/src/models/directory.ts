import { DirectoryExceptionKind, IsoDate, PersonId } from '@repo/domain';
import { Schema } from 'effect';

/** Largest HR file accepted in one request (about 20,000 rows). */
export const MAX_DIRECTORY_CSV_LENGTH = 4_000_000;

/**
 * A full HR snapshot as CSV, header row first:
 * `email, display_name, title, location, business_function, manager_email, job_family, entra_object_id`
 * (`entra_object_id` optional). People missing from the file are departure
 * candidates; they are departed only with `applyDepartures`.
 */
export const DirectoryImportInput = Schema.Struct({
  csv: Schema.String.pipe(Schema.check(Schema.isMaxLength(MAX_DIRECTORY_CSV_LENGTH))),
  dryRun: Schema.Boolean,
  applyDepartures: Schema.optional(Schema.Boolean),
  /** When manager and position changes take effect. Defaults to today. */
  effectiveOn: Schema.optional(IsoDate),
});
export type DirectoryImportInput = typeof DirectoryImportInput.Type;

export const DirectoryAdded = Schema.Struct({
  email: Schema.String,
  displayName: Schema.String,
  title: Schema.NullOr(Schema.String),
  managerEmail: Schema.NullOr(Schema.String),
});

export const DirectoryFieldChange = Schema.Struct({
  field: Schema.String,
  from: Schema.NullOr(Schema.String),
  to: Schema.NullOr(Schema.String),
});

export const DirectoryUpdated = Schema.Struct({
  personId: PersonId,
  email: Schema.String,
  displayName: Schema.String,
  changes: Schema.Array(DirectoryFieldChange),
});

export const DirectoryDeparture = Schema.Struct({
  personId: PersonId,
  email: Schema.String,
  displayName: Schema.String,
});

export const DirectoryManagerChange = Schema.Struct({
  email: Schema.String,
  displayName: Schema.String,
  fromManagerEmail: Schema.NullOr(Schema.String),
  toManagerEmail: Schema.NullOr(Schema.String),
});

/** Job family, title and business function: a person's dated position (ADR 0017). */
export const DirectoryPosition = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  jobFamily: Schema.NullOr(Schema.String),
  businessFunction: Schema.NullOr(Schema.String),
});

export const DirectoryPositionChange = Schema.Struct({
  email: Schema.String,
  displayName: Schema.String,
  /** Null when the person has no open position yet. */
  from: Schema.NullOr(DirectoryPosition),
  to: DirectoryPosition,
});

export const DirectoryTaxonomyAdded = Schema.Struct({
  kind: Schema.Literals(['business_function', 'job_family']),
  name: Schema.String,
});

export const DirectoryDiff = Schema.Struct({
  added: Schema.Array(DirectoryAdded),
  updated: Schema.Array(DirectoryUpdated),
  departed: Schema.Array(DirectoryDeparture),
  managerChanges: Schema.Array(DirectoryManagerChange),
  positionChanges: Schema.Array(DirectoryPositionChange),
  taxonomyAdded: Schema.Array(DirectoryTaxonomyAdded),
});
export type DirectoryDiff = typeof DirectoryDiff.Type;

/** A rule the HR data breaks, or a row that could not be applied. Never an import failure. */
export const DirectoryExceptionFinding = Schema.Struct({
  kind: DirectoryExceptionKind,
  personEmail: Schema.NullOr(Schema.String),
  detail: Schema.String,
});
export type DirectoryExceptionFinding = typeof DirectoryExceptionFinding.Type;

export const DirectoryImportResult = Schema.Struct({
  dryRun: Schema.Boolean,
  /** True when the changes were written. A dry run writes nothing. */
  applied: Schema.Boolean,
  effectiveOn: IsoDate,
  rows: Schema.Number,
  diff: DirectoryDiff,
  exceptions: Schema.Array(DirectoryExceptionFinding),
  /** Departures carried out (only with `applyDepartures`). */
  departuresApplied: Schema.Number,
});
export type DirectoryImportResult = typeof DirectoryImportResult.Type;

export const DepartInput = Schema.Struct({
  /** The leaving date. Defaults to today; at most 30 days back, never ahead. */
  effectiveOn: Schema.optional(IsoDate),
});
export type DepartInput = typeof DepartInput.Type;

/** What a departure closed. Signed history, credit and badges are never touched. */
export const DepartureResult = Schema.Struct({
  personId: PersonId,
  effectiveOn: IsoDate,
  sessionsEnded: Schema.Number,
  reportingLinesEnded: Schema.Number,
  grantsEnded: Schema.Number,
  positionsEnded: Schema.Number,
  engagementsEnded: Schema.Number,
  designationsEnded: Schema.Number,
  requestsExpired: Schema.Number,
  notificationsSkipped: Schema.Number,
  exceptions: Schema.Array(DirectoryExceptionFinding),
});
export type DepartureResult = typeof DepartureResult.Type;
