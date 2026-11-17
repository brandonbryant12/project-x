import { CurrentActor, Forbidden, NotFound, Unprocessable } from '@repo/api';
import {
  checkObserverEligibility,
  INELIGIBLE_REASON_TEXT,
  type EvidenceStatus,
  type InteractionId,
  type IsoDate,
  type ObservationId,
  type PersonId,
  type SkillId,
  type SkillVersionId,
  type TenantId,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDays, now } from '../../../platform/time.ts';
import { loadRelationshipFacts } from '../../shared/relationships.ts';
import { canSeeObservation, loadObservation } from '../views.ts';

export const DEFAULT_WINDOW_DAYS = 14;

/** Eligibility as of the interaction date (invariant I4), as a typed failure. */
export const requireEligible = Effect.fn('observations.requireEligible')(function* (
  tenantId: TenantId,
  input: { observerId: PersonId; subjectId: PersonId; on: IsoDate },
) {
  const facts = yield* loadRelationshipFacts(tenantId);
  const result = checkObserverEligibility(facts, input);
  if (!result.eligible) {
    return yield* Effect.fail(new Forbidden({ message: INELIGIBLE_REASON_TEXT[result.reason] }));
  }
  return result.basis;
});

/** Current published versions for skills, pinned on ratings. */
export const currentVersions = Effect.fn('observations.currentVersions')(function* (
  tenantId: TenantId,
  skillIds: ReadonlyArray<SkillId>,
) {
  const db = yield* Db;
  const rows = yield* db
    .select({
      id: schema.skill.id,
      versionId: schema.skill.currentVersionId,
      status: schema.skill.status,
    })
    .from(schema.skill)
    .where(and(eq(schema.skill.tenantId, tenantId), inArray(schema.skill.id, [...skillIds])));
  const versions = new Map<SkillId, SkillVersionId>();
  for (const row of rows) {
    if (row.status === 'published' && row.versionId) versions.set(row.id, row.versionId);
  }
  if (versions.size !== new Set(skillIds).size) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Choose published skills.', field: 'skills' }),
    );
  }
  return versions;
});

export const dueDate = Effect.fn('observations.dueDate')(function* (tenantId: TenantId) {
  const db = yield* Db;
  const [tenant] = yield* db
    .select({ settings: schema.tenant.settings })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, tenantId));
  return addDays(yield* now, tenant?.settings.observationWindowDays ?? DEFAULT_WINDOW_DAYS);
});

/** Loads an observation the actor may see, or NotFound (concealment). */
export const loadVisible = Effect.fn('observations.loadVisible')(function* (id: ObservationId) {
  const actor = yield* CurrentActor;
  const row = yield* loadObservation(actor, id);
  if (!row || !(yield* canSeeObservation(actor, row))) {
    return yield* Effect.fail(new NotFound({ entity: 'observation', id }));
  }
  return row;
});

/** The status of the latest reflection on a piece of work, if it has one. */
export const latestEvidenceStatus = Effect.fn('observations.evidenceStatus')(function* (
  tenantId: TenantId,
  interactionId: InteractionId,
) {
  const db = yield* Db;
  const [row] = yield* db
    .select({ status: schema.evidence.status })
    .from(schema.evidence)
    .where(
      and(eq(schema.evidence.tenantId, tenantId), eq(schema.evidence.interactionId, interactionId)),
    )
    .orderBy(desc(schema.evidence.createdAt))
    .limit(1);
  return row ? (row.status as EvidenceStatus) : null;
});
