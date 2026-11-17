import {
  coacheesOf,
  designatedObserversOf,
  directReportsOf,
  eligibleObserversOf,
  hasCoachGrantOn,
  type PersonId,
  type RelationshipFacts,
  type IsoDate,
} from '@repo/domain';

/** Relationship flags that shape navigation and Home (docs/product/ux-brief.md § IA). */
export const relationFlags = (facts: RelationshipFacts, personId: PersonId, on: IsoDate) => {
  const hasReports = directReportsOf(facts, personId, on).length > 0;
  const isCoach = hasCoachGrantOn(facts, personId, on);
  const hasCoachees = isCoach && coacheesOf(facts, personId, on).length > 0;
  const isDesignated = designatedSubjectsOf(facts, personId, on).length > 0;
  return {
    hasReports,
    isCoach,
    hasCoachees,
    canObserve: hasReports || hasCoachees || isDesignated,
  };
};

/** People whose leader or coach designated `observerId` to observe them on `on` (ADR 0020). */
const designatedSubjectsOf = (facts: RelationshipFacts, observerId: PersonId, on: IsoDate) =>
  [...new Set((facts.designations ?? []).map((d) => d.subjectId))].filter((subjectId) =>
    designatedObserversOf(facts, subjectId, on).includes(observerId),
  );

/** People the actor can observe today, with the basis. */
export const observableBy = (facts: RelationshipFacts, observerId: PersonId, on: IsoDate) => {
  const candidates = new Set<PersonId>([
    ...directReportsOf(facts, observerId, on),
    ...coacheesOf(facts, observerId, on),
    ...designatedSubjectsOf(facts, observerId, on),
  ]);
  return [...candidates].flatMap((subjectId) =>
    eligibleObserversOf(facts, subjectId, on)
      .filter((o) => o.personId === observerId)
      .map((o) => ({ subjectId, basis: o.basis })),
  );
};

/** A short phrase for how `viewer` relates to `subject`, or null. */
export const relationLabel = (
  facts: RelationshipFacts,
  viewerId: PersonId,
  subjectId: PersonId,
  on: IsoDate,
): string | null => {
  if (viewerId === subjectId) return 'You';
  if (directReportsOf(facts, viewerId, on).includes(subjectId)) return 'Your report';
  if (directReportsOf(facts, subjectId, on).includes(viewerId)) return 'Your leader';
  if (coacheesOf(facts, viewerId, on).includes(subjectId)) return 'Your coachee';
  if (coacheesOf(facts, subjectId, on).includes(viewerId)) return 'Your coach';
  return null;
};
