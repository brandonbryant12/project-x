import { schema } from '@repo/db';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Architecture invariants (docs/testing/invariants.md I2, I9, I23, I24). They
 * read the source and schema, so they fail when code moves in a way that
 * breaks a rule.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));

const sourceFiles = (dir: string): Array<string> =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });

const writersOf = (table: string, files = sourceFiles(SRC)) =>
  files
    .filter((file) =>
      new RegExp(`\\.insert\\(schema\\.${table}\\)`).test(readFileSync(file, 'utf8')),
    )
    .map((file) => relative(SRC, file))
    .toSorted();

const tables = () =>
  Object.entries(schema).flatMap(([key, value]) =>
    value instanceof PgTable ? [{ key, name: getTableConfig(value).name, table: value }] : [],
  );

/**
 * Cross-feature imports. The list is empty: shared reads and services (the
 * advisory runner included) live in `features/shared/`. A new edge fails the
 * test; add one here only with a reason in review.
 */
const CROSS_FEATURE_DEBT: ReadonlyArray<string> = [];

/**
 * Tables with no writer in the running server (seed scripts and tests do not
 * count). Each entry says why; when a writer lands, delete the entry.
 */
const RESERVED: Readonly<Record<string, string>> = {
  tenant: 'provisioned by the seed or by hand; tenant onboarding is not built',
  skill: 'catalog is seeded; catalog management is not built',
  skillVersion: 'catalog is seeded; catalog management is not built',
  skillLevel: 'catalog is seeded; catalog management is not built',
  skillIndicator: 'catalog is seeded; catalog management is not built',
  activityTemplate: 'catalog is seeded; catalog management is not built',
  activityTemplateSkill: 'catalog is seeded; catalog management is not built',
  skillProfile: 'columns only until HR signs off profiles (ADR 0017)',
  secondRead: 'blind calibration reads are designed, not built',
  secondReadRating: 'blind calibration reads are designed, not built',
  badgeWaiver: 'audited criterion exceptions are designed, not built',
  legalHold: 'the purge job that honours holds is not built',
};

describe('architecture', () => {
  it('I2: only signing writes credit; only voiding writes reversals', () => {
    expect(writersOf('creditEntry')).toEqual(['features/observations/use-cases/sign.ts']);
    expect(writersOf('creditReversal')).toEqual(['features/observations/use-cases/transition.ts']);
  });

  it('I9: every table is tenant-scoped, except the declared global ones', () => {
    const GLOBAL = new Set(['tenant']);
    const all = tables();
    expect(all.length).toBeGreaterThan(25);
    const unscoped = all
      .map(({ table }) => getTableConfig(table))
      .filter(
        (config) => !GLOBAL.has(config.name) && !config.columns.some((c) => c.name === 'tenant_id'),
      )
      .map((config) => config.name);
    expect(unscoped).toEqual([]);
  });

  it('I23: a feature imports only its own folder and features/shared (debt list shrinks)', () => {
    const edges = sourceFiles(join(SRC, 'features')).flatMap((file) => {
      const from = relative(SRC, file);
      const [, owner] = from.split('/');
      const specifiers = [...readFileSync(file, 'utf8').matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)];
      return specifiers.flatMap(([, specifier]) => {
        const to = relative(SRC, resolve(dirname(file), specifier ?? ''));
        const [root, target] = to.split('/');
        if (root !== 'features' || target === owner || target === 'shared') return [];
        return [`${from} -> ${to}`];
      });
    });
    expect(edges.toSorted()).toEqual(CROSS_FEATURE_DEBT.toSorted());
  });

  it('I24: every table has a writer in the server or is declared reserved, with a reason', () => {
    const server = sourceFiles(SRC).filter(
      (file) =>
        !relative(SRC, file).startsWith('scripts/') && !relative(SRC, file).startsWith('test/'),
    );
    const unwritten = tables()
      .filter(({ key }) => writersOf(key, server).length === 0)
      .map(({ key }) => key)
      .toSorted();
    // Fails both ways: a new table without a writer, and a reserved table that gained one.
    expect(unwritten).toEqual(Object.keys(RESERVED).toSorted());
  });
});
