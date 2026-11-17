import { OpenApi } from 'effect/http-api';
import { describe, expect, it } from 'vitest';
import { Api } from './api.ts';

describe('Api contract', () => {
  const spec = OpenApi.fromApi(Api);

  it('serves every endpoint under /api', () => {
    const paths = Object.keys(spec.paths);
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.every((p) => p.startsWith('/api/'))).toBe(true);
  });

  it('has a unique operation id per endpoint', () => {
    const ids = Object.values(spec.paths).flatMap((ops) =>
      Object.values(ops as Record<string, { operationId?: string }>).map((op) => op.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
