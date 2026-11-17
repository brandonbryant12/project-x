import { defineConfig } from '@playwright/test';

/**
 * Capture timing (path to A, product evidence): how long a practiced observer
 * takes from tapping "I saw this" to a signed observation on a 390px phone.
 * Not part of any default run. With the API (:4400) and Vite (:5400) running:
 *   pnpm --filter @repo/web e2e:timing
 * Each run signs a real observation in the local database (`pnpm db:reset` restores the seed).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'capture-timing.spec.ts',
  timeout: 1_200_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:5400',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    // A run stuck behind a dev API restart fails fast and is replaced (see the spec).
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
});
