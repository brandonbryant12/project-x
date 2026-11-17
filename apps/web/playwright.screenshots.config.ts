import { defineConfig } from '@playwright/test';

/**
 * Visual review loop (ADR 0010). Assumes the API (:4400) and Vite (:5400) are
 * already running with seeded data:
 *   pnpm --filter @repo/server dev && pnpm --filter @repo/web dev
 *   pnpm --filter @repo/web screenshots
 * Narrow a run: PERSONAS="Maya Chen,Leo Okonkwo" ROUTES=home,observation THEMES=light VIEWPORTS=desktop
 * Each persona also gets an overflow check at 360/390/768/1280 px (no sideways scroll).
 * CHECK=overflow runs only that; CHECK=screens only the screenshots.
 * Output: apps/web/screenshots/<persona>/<route>-<theme>-<viewport>.png (gitignored).
 * E2E_BASE_URL points the run at another origin (default http://localhost:5400), for
 * example one server that serves both the API and the built app on a free port.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'screenshots.spec.ts',
  timeout: 900_000,
  workers: 3,
  reporter: 'list',
  use: { baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:5400' },
});
