import { DesignationId, IsoDate, PersonId } from '@repo/domain';
import { Schema } from 'effect';
import { PersonSummary } from './common.ts';

/* ---------- Designated observers (ADR 0020) ---------- */

export const DesignationView = Schema.Struct({
  id: DesignationId,
  subject: PersonSummary,
  observer: PersonSummary,
  designatedBy: PersonSummary,
  validFrom: IsoDate,
  /** The effective end (an early end if there was one). */
  validTo: IsoDate,
  active: Schema.Boolean,
  canEnd: Schema.Boolean,
});
export type DesignationView = typeof DesignationView.Type;

export const DesignateInput = Schema.Struct({
  subjectId: PersonId,
  observerId: PersonId,
  validFrom: IsoDate,
  validTo: IsoDate,
});

/* ---------- Notifications (ADR 0018) ---------- */

/** Two switches: email when something waits on you, and the Monday digest. */
export const NotificationPreferences = Schema.Struct({
  sendEmail: Schema.Boolean,
  weeklyDigest: Schema.Boolean,
});
export type NotificationPreferences = typeof NotificationPreferences.Type;

/* ---------- Adoption (ADR 0021): four numbers, aggregates only, no names ---------- */

/** Every nullable figure is null when drawn from fewer than `minimumCell` (shown as "fewer than 5"). */
export const AdoptionView = Schema.Struct({
  asOf: IsoDate,
  minimumCell: Schema.Number,
  /** People with an active or paused plan. */
  withPlan: Schema.Number,
  /** Of those, people observed for work in the last six weeks. */
  observedRecently: Schema.NullOr(Schema.Number),
  /** Over the last four complete weeks: days from logging the work to the signature. */
  medianDaysToSign: Schema.NullOr(Schema.Number),
  /** Over the last four weeks: share of requests whose window closed without a signature. */
  expiryRate: Schema.NullOr(Schema.Number),
});
export type AdoptionView = typeof AdoptionView.Type;
