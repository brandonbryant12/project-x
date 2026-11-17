import { Context, Effect, Layer, Redacted } from 'effect';
import { Client, RunTree } from 'langsmith';
import type { AppConfig } from './config.ts';

/**
 * Optional LangSmith workbench for assistant checks (ADR 0016). Postgres stays
 * the system of record; this mirrors each check as a run tree and posts
 * ground-truth labels as feedback. Off unless LANGSMITH_TRACING=true.
 *
 * Privacy: with LANGSMITH_CONTENT=none (default) no text is sent — only digests,
 * question keys, probabilities and interpretations.
 */
export interface CheckTrace {
  readonly questionSet: string;
  readonly version: number;
  readonly arm: 'shown' | 'shadow';
  readonly subjectType: string;
  readonly provider: string;
  readonly inputDigest: string;
  readonly questionKeys: ReadonlyArray<string>;
  /** Only passed when the caller has established the text may leave (screened mode). */
  readonly text: string | null;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly thresholds: Readonly<Record<string, number>>;
  readonly interpretation: { readonly effect: string; readonly rationale: string };
  readonly startedAt: number;
  readonly endedAt: number;
}

export class Tracing extends Context.Service<
  Tracing,
  {
    readonly enabled: boolean;
    /** Whether screened text may be included in traces. */
    readonly includeScreenedText: boolean;
    /** Returns the root run id, or null when disabled or on failure (never fails the check). */
    readonly traceCheck: (trace: CheckTrace) => Effect.Effect<string | null>;
    readonly feedback: (
      runId: string,
      key: string,
      score: number,
      metadata: Readonly<Record<string, string>>,
    ) => Effect.Effect<void>;
  }
>()('@repo/server/Tracing') {
  static readonly disabled = Layer.succeed(
    Tracing,
    Tracing.of({
      enabled: false,
      includeScreenedText: false,
      traceCheck: () => Effect.succeed(null),
      feedback: () => Effect.void,
    }),
  );

  static readonly layer = (config: AppConfig) => {
    const { tracing, apiKey, project, content } = config.langsmith;
    if (!tracing || !apiKey) return Tracing.disabled;
    const client = new Client({ apiKey: Redacted.value(apiKey) });
    const traceCheck = (t: CheckTrace) =>
      Effect.tryPromise(async () => {
        const root = new RunTree({
          name: `advisory.${t.questionSet}`,
          run_type: 'chain',
          project_name: project,
          client,
          start_time: t.startedAt,
          inputs: {
            inputDigest: t.inputDigest,
            subjectType: t.subjectType,
            ...(t.text !== null && { text: t.text }),
          },
          metadata: {
            questionSet: t.questionSet,
            version: t.version,
            arm: t.arm,
            provider: t.provider,
          },
        });
        await root.postRun();
        const evaluate = root.createChild({
          name: 'decisions.evaluate',
          run_type: 'llm',
          start_time: t.startedAt,
          inputs: { questionKeys: t.questionKeys, inputDigest: t.inputDigest },
        });
        await evaluate.postRun();
        await evaluate.end({ answers: t.answers }, undefined, t.endedAt);
        await evaluate.patchRun();
        const interpret = root.createChild({
          name: 'interpret.thresholds',
          run_type: 'chain',
          inputs: { thresholds: t.thresholds },
        });
        await interpret.postRun();
        await interpret.end({ ...t.interpretation });
        await interpret.patchRun();
        await root.end(
          { effect: t.interpretation.effect, rationale: t.interpretation.rationale },
          undefined,
          t.endedAt,
        );
        await root.patchRun();
        return root.id;
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning('langsmith trace failed', { error: String(error) }).pipe(
            Effect.as(null),
          ),
        ),
      );
    const feedback = (
      runId: string,
      key: string,
      score: number,
      metadata: Readonly<Record<string, string>>,
    ) =>
      Effect.tryPromise(() =>
        client.createFeedback(runId, key, { score, sourceInfo: { ...metadata } }),
      ).pipe(
        Effect.asVoid,
        Effect.catch((error) =>
          Effect.logWarning('langsmith feedback failed', { error: String(error) }),
        ),
      );
    return Layer.succeed(
      Tracing,
      Tracing.of({
        enabled: true,
        includeScreenedText: content === 'screened',
        traceCheck,
        feedback,
      }),
    );
  };
}
