import { defineConfig } from 'vitest/config';

// PGlite boots and migrates in each suite's layer hook; under `pnpm check`'s
// parallel load that can exceed the 10s default and close the database early.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });
