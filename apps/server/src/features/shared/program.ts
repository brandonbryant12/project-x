import type { IsoDate, TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { Effect } from 'effect';
import { addDaysIso } from '../../platform/time.ts';

/**
 * Program figures (ADR 0021): aggregates only, never names. Any count drawn
 * from fewer than MIN_CELL people is withheld (null).
 */
export const MIN_CELL = 5;

const cell =(n: number) => (n >= MIN_CELL ? n : null);

/**
 * How many people have an active or paused plan, and how many of them were
 * observed (signed) for work done in the last six weeks of business days.
 */
export const planCoverage = Effect.fn('program.coverage')(function* (
  tenantId: TenantId,
  on: IsoDate,
) {
  const db = yield* Db;
  const owners = yield* db
    .selectDistinct({ ownerId: schema.plan.ownerId })
    .from(schema.plan)
    .where(
      and(eq(schema.plan.tenantId, tenantId), inArray(schema.plan.status, ['active', 'paused'])),
    );
  const observed = owners.length
    ? yield* db
        .selectDistinct({ subjectId: schema.observation.subjectId })
        .from(schema.observation)
        .innerJoin(schema.interaction, eq(schema.interaction.id, schema.observation.interactionId))
        .where(
          and(
            eq(schema.observation.tenantId, tenantId),
            isNotNull(schema.observation.signedAt),
            gte(schema.interaction.occurredOn, addDaysIso(on, -42)),
            inArray(
              schema.observation.subjectId,
              owners.map((o) => o.ownerId),
            ),
          ),
        )
    : [];
  return { withPlan: owners.length, observed: cell(observed.length) };
});
