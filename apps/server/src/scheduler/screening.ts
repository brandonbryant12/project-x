import { Decisions } from '@repo/ai';
import type { EvidenceId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../platform/time.ts';
import { screenEvidenceWithAssistant } from '../features/shared/advisory/evidence-screening.ts';

/**
 * Recovers missed assistant screenings (ADR 0008, 0012). Logging or revising a
 * reflection schedules its assistant screen after commit, in process; if the
 * server stops in between, nothing else would ever screen it. This sweep finds
 * reflections that should have been screened and were not, and screens them.
 *
 * A reflection is due when all of these hold:
 *  - assistant checks are enabled (otherwise the sweep does nothing);
 *  - it is `available` and not purged, and its current version came from the
 *    author (its latest audit event is SUBMIT or REVISE). Text a person
 *    released or resolved is never sent back to the assistant;
 *  - its current version was written between SCREEN_LOOKBACK_MS and
 *    SCREEN_GRACE_MS ago. The grace gives the after-commit screen the first
 *    go. The lookback is what keeps switching the assistant on from sending
 *    older reflections to the provider, which would be a new data flow;
 *  - its current version has no settled check: none `completed` or `skipped`
 *    (a skip is a decision: the assistant was off, or the local screen held
 *    the text), and no attempt started within RETRY_AFTER_MS (a `pending`
 *    check is in flight; a `failed` one waits before the retry);
 *  - fewer than MAX_SCREEN_ATTEMPTS checks were attempted at that version.
 *    Each `failed` check and each `pending` one counts (a `pending` check
 *    older than RETRY_AFTER_MS was abandoned mid-call).
 *
 * After the last attempt the reflection stays as it is, with its failed checks
 * on record: a failure is never a pass and never a hold (ADR 0008). Two
 * replicas can occasionally screen the same reflection twice; a hold applies
 * only to the version screened, so the second result changes nothing.
 */
export const SCREEN_GRACE_MS = 5 * 60_000;
export const SCREEN_LOOKBACK_MS = 2 * 86_400_000;
export const RETRY_AFTER_MS = 15 * 60_000;
export const MAX_SCREEN_ATTEMPTS = 3;
const SCREEN_BATCH = 10;

export const runScreeningSweep = Effect.fn('sweep.screening')(function* () {
  const decisions = yield* Decisions;
  if (!decisions.availability.enabled) return 0;
  const db = yield* Db;
  const at = (yield* now).getTime();
  const e = schema.evidence;
  const c = schema.advisoryCheck;
  const a = schema.auditEvent;
  const thisVersion = and(
    eq(c.tenantId, e.tenantId),
    eq(c.subjectType, 'evidence'),
    eq(c.subjectId, e.id),
    eq(c.subjectVersion, e.version),
  );
  const settledOrRecent = or(
    inArray(c.status, ['completed', 'skipped']),
    gte(c.createdAt, new Date(at - RETRY_AFTER_MS)),
  );
  const due = yield* db
    .select({ id: e.id, tenantId: e.tenantId })
    .from(e)
    .where(
      and(
        eq(e.status, 'available'),
        isNull(e.purgedAt),
        isNotNull(e.body),
        gte(e.updatedAt, new Date(at - SCREEN_LOOKBACK_MS)),
        lte(e.updatedAt, new Date(at - SCREEN_GRACE_MS)),
        sql`(select ${a.event} from ${a}
              where ${a.tenantId} = ${e.tenantId} and ${a.entityType} = 'evidence' and ${a.entityId} = ${e.id}
              order by ${a.seq} desc limit 1) in ('SUBMIT', 'REVISE')`,
        sql`not exists (select 1 from ${c} where ${thisVersion} and ${settledOrRecent})`,
        sql`(select count(*) from ${c} where ${thisVersion}) < ${MAX_SCREEN_ATTEMPTS}`,
      ),
    )
    .orderBy(asc(e.updatedAt))
    .limit(SCREEN_BATCH);
  // One at a time, outside any transaction: each screen may call the provider.
  for (const row of due) {
    yield* screenEvidenceWithAssistant({ tenantId: row.tenantId }, row.id as EvidenceId);
  }
  if (due.length > 0) yield* Effect.logInfo('screening sweep', { screened: due.length });
  return due.length;
});
