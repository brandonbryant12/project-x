// The Postgres lane (docs/testing/strategy.md): runs the database integrity
// and scenario suites against real PostgreSQL instead of PGlite.
//
// TEST_DATABASE_URL names an admin connection (any database the role can
// connect to). Each suite creates its own throwaway database next to it and
// drops it afterwards, so the dev database is never touched. Defaults to the
// `postgres` maintenance database of `pnpm db:up`.
import { spawnSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://app:app@127.0.0.1:5442/postgres';
const result = spawnSync(
  'pnpm',
  [
    '--filter',
    '@repo/db',
    '--filter',
    '@repo/server',
    '--workspace-concurrency=1',
    'exec',
    'vitest',
    'run',
    // One file at a time: each file holds its own database and pool, and
    // parallel files on a small Postgres stalled (not yet root-caused).
    '--no-file-parallelism',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url } },
);
process.exit(result.status ?? 1);
