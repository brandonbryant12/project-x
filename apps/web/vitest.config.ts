import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Unit tests only; Playwright specs in e2e/ run via `pnpm e2e` / `pnpm screenshots`. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.{ts,tsx}'], passWithNoTests: true },
});
