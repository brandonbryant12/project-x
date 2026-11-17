import type { Actor } from '@repo/api';
import { screenLocally, type ObservationId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { loadDefinitions } from '../catalog-reads.ts';
import { armFor, modeConsistency, narrativeIndicators, narrativeQuality } from './question-sets.ts';
import { runCheck } from './runner.ts';

/**
 * After the observer has written (human first, ADR 0016): propose indicators
 * the note describes, nudge specificity, and check that a first-hand mode
 * reads first-hand. A deterministic slice runs in the shadow arm.
 */
export const runNarrativeChecks = Effect.fn('advisory.narrativeChecks')(function* (
  actor: Actor,
  observationId: ObservationId,
) {
  const db = yield* Db;
  const [observation] = yield* db
    .select()
    .from(schema.observation)
    .where(eq(schema.observation.id, observationId));
  if (!observation || !['requested', 'drafting'].includes(observation.status)) return;
  const text = [observation.narrativeSaw, observation.narrativeNext]
    .filter((t): t is string => t !== null && t.trim().length > 0)
    .join('\n\n');
  const arm = armFor(observation.id);
  const ratings = yield* db
    .select()
    .from(schema.observationRating)
    .where(eq(schema.observationRating.observationId, observation.id));
  const definitions = yield* loadDefinitions(
    actor.tenantId,
    ratings.map((r) => r.skillVersionId),
  );
  const defs = [...definitions.values()];
  const indicatorIds = defs.flatMap((d) => d.levels.flatMap((l) => l.indicators.map((i) => i.id)));
  const subject = {
    // The observer's own note; screened when the local privacy screen passes.
    screened: !screenLocally(text).held,
    subjectType: 'observation',
    subjectId: observation.id,
    subjectVersion: observation.version,
    text,
    arm,
    actor,
  } as const;

  const indicatorsBuilt = narrativeIndicators.build(defs);
  yield* runCheck({
    ...subject,
    questionSet: narrativeIndicators,
    built: indicatorsBuilt,
    interpret: (r) =>
      narrativeIndicators.interpret(r.answers, indicatorsBuilt.thresholds, indicatorIds),
  });
  const qualityBuilt = narrativeQuality.build();
  yield* runCheck({
    ...subject,
    questionSet: narrativeQuality,
    built: qualityBuilt,
    interpret: (r) => narrativeQuality.interpret(r.answers, qualityBuilt.thresholds),
  });
  if (observation.mode !== 'discussed') {
    const modeBuilt = modeConsistency.build();
    yield* runCheck({
      ...subject,
      questionSet: modeConsistency,
      built: modeBuilt,
      interpret: (r) => modeConsistency.interpret(r.answers, modeBuilt.thresholds),
    });
  }
});
