import type { IsoDate, PersonId } from '../ids.ts';

/**
 * Relationship facts with effective dates, as loaded from the database. All
 * relationship questions ("who leads whom on date D?") are answered here so the
 * rules stay consistent between eligibility, visibility and navigation.
 *
 * Intervals are half-open: valid on `from <= d < to`; `to: null` means open.
 */
export interface DatedEdge {
  readonly from: IsoDate;
  readonly to: IsoDate | null;
}

export interface ReportingLineFact extends DatedEdge {
  readonly managerId: PersonId;
  readonly reportId: PersonId;
}

export interface EngagementFact extends DatedEdge {
  readonly coachId: PersonId;
  readonly coacheeId: PersonId;
  /** `from` is the acceptance date; proposals that were never accepted are excluded. */
}

export interface CoachGrantFact extends DatedEdge {
  readonly personId: PersonId;
}

/** A colleague named as an observer for the subject (ADR 0020). `to` is always set. */
export interface DesignationFact extends DatedEdge {
  readonly observerId: PersonId;
  readonly subjectId: PersonId;
}

export interface RelationshipFacts {
  readonly reportingLines: ReadonlyArray<ReportingLineFact>;
  readonly engagements: ReadonlyArray<EngagementFact>;
  readonly coachGrants: ReadonlyArray<CoachGrantFact>;
  readonly designations?: ReadonlyArray<DesignationFact>;
}

export const isActiveOn = (edge: DatedEdge, date: IsoDate): boolean =>
  edge.from <= date && (edge.to === null || date < edge.to);

/** The person's direct leader on `date`, if any. */
export const leaderOf = (
  facts: RelationshipFacts,
  personId: PersonId,
  date: IsoDate,
): PersonId | undefined =>
  facts.reportingLines.find((line) => line.reportId === personId && isActiveOn(line, date))
    ?.managerId;

/** The chain of leaders above a person on `date`, nearest first. Cycle-safe. */
export const leaderChainOf = (
  facts: RelationshipFacts,
  personId: PersonId,
  date: IsoDate,
): ReadonlyArray<PersonId> => {
  const chain: Array<PersonId> = [];
  const seen = new Set<PersonId>([personId]);
  let current = leaderOf(facts, personId, date);
  while (current !== undefined && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = leaderOf(facts, current, date);
  }
  return chain;
};

export const directReportsOf = (
  facts: RelationshipFacts,
  personId: PersonId,
  date: IsoDate,
): ReadonlyArray<PersonId> =>
  facts.reportingLines
    .filter((line) => line.managerId === personId && isActiveOn(line, date))
    .map((line) => line.reportId);

export const hasCoachGrantOn = (
  facts: RelationshipFacts,
  personId: PersonId,
  date: IsoDate,
): boolean => facts.coachGrants.some((g) => g.personId === personId && isActiveOn(g, date));

export const coachesOf = (
  facts: RelationshipFacts,
  coacheeId: PersonId,
  date: IsoDate,
): ReadonlyArray<PersonId> =>
  facts.engagements
    .filter(
      (e) =>
        e.coacheeId === coacheeId && isActiveOn(e, date) && hasCoachGrantOn(facts, e.coachId, date),
    )
    .map((e) => e.coachId);

export const coacheesOf = (
  facts: RelationshipFacts,
  coachId: PersonId,
  date: IsoDate,
): ReadonlyArray<PersonId> =>
  facts.engagements
    .filter((e) => e.coachId === coachId && isActiveOn(e, date))
    .map((e) => e.coacheeId);

/** People designated to observe `subjectId` on `date` (ADR 0020). */
export const designatedObserversOf = (
  facts: RelationshipFacts,
  subjectId: PersonId,
  date: IsoDate,
): ReadonlyArray<PersonId> =>
  (facts.designations ?? [])
    .filter((d) => d.subjectId === subjectId && isActiveOn(d, date))
    .map((d) => d.observerId);
