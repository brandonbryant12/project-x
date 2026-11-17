import type { Actor } from '@repo/api';
import {
  canReadNarrative,
  type IsoDate,
  type PersonId,
  type RelationshipFacts,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { Effect } from 'effect';

/** Observations whose words stand: signed, or under review (the credit stands meanwhile). */
const SIGNED_STATES = ['signed', 'under_review'] as const;

/**
 * "Try next time" (CONTEXT.md): the latest signed observation's "What next"
 * about `subjectId`, or null. A draft has not been signed and a voided
 * observation no longer stands, so neither is ever returned. The words are
 * returned only to a viewer who may read the narrative (I13); the subject
 * always may.
 */
export const latestTryNextTime = Effect.fn('shared.tryNextTime')(function* (
  actor: Actor,
  facts: RelationshipFacts,
  subjectId: PersonId,
  on: IsoDate,
) {
  const db = yield* Db;
  const [row] = yield* db
    .select({
      id: schema.observation.id,
      observerId: schema.observation.observerId,
      narrativeNext: schema.observation.narrativeNext,
      signedAt: schema.observation.signedAt,
    })
    .from(schema.observation)
    .where(
      and(
        eq(schema.observation.tenantId, actor.tenantId),
        eq(schema.observation.subjectId, subjectId),
        inArray(schema.observation.status, SIGNED_STATES),
        isNotNull(schema.observation.signedAt),
        isNotNull(schema.observation.narrativeNext),
        ne(schema.observation.narrativeNext, ''),
      ),
    )
    .orderBy(desc(schema.observation.signedAt), desc(schema.observation.id))
    .limit(1);
  if (!row?.narrativeNext?.trim() || !row.signedAt) return null;
  const readable = canReadNarrative(facts, {
    viewerId: actor.personId,
    subjectId,
    observerId: row.observerId,
    on,
  });
  if (!readable) return null;
  return {
    sentence: row.narrativeNext,
    observerId: row.observerId,
    signedAt: row.signedAt,
    observationId: row.id,
  };
});
