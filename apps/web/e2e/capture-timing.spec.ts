import { expect, test, type Page } from '@playwright/test';

/**
 * Median time from tapping "I saw this" to the signed receipt, over RUNS runs.
 *
 * The observer is modelled as practiced, on a 390px phone, using the phone's
 * own dictation for the two comments (the plan's quick-capture assumption):
 * - a pause before each decision (finding the person, reading the ladder,
 *   checking the review) instead of instant clicks;
 * - comments entered at DICTATION_MS per character (default 90 ms, about
 *   130 words a minute, a typical dictation pace), after a pause to start
 *   dictating. Set DICTATION_MS=300 to model thumb typing instead.
 * Defaults are tunable by env so the number can be challenged, not trusted.
 */
const OBSERVER = process.env['OBSERVER'] ?? 'Leo Okonkwo';
const RUNS = Number(process.env['RUNS'] ?? 10);
const MS_PER_CHAR = Number(process.env['DICTATION_MS'] ?? 90);
const BUDGET_MS = 60_000;

const SAW =
  'Opened by asking what had changed since spring, then let the silence work. The household named a goal we had never heard and the plan moved because of it.';
const NEXT = 'Next time, summarise their goal back before showing any numbers.';

const think = (page: Page, ms: number) => page.waitForTimeout(ms);
/** Wait out a dev API restart (watch mode) before the clock starts, rather than failing. */
const apiReady = async (page: Page) => {
  for (let attempt = 1; attempt <= 40; attempt++) {
    const response = await page.request.get('/api/session', { headers: H });
    if (response.ok()) return;
    await page.waitForTimeout(1500);
  }
  throw new Error('The API did not come back');
};
const H = { 'x-requested-with': 'fetch' };
const median = (xs: ReadonlyArray<number>) => {
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

test(`capture timing · ${OBSERVER} · ${RUNS} runs`, async ({ page, playwright }, info) => {
  const api = await playwright.request.newContext({
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:5400',
  });
  let personas: Array<{ person: { id: string; displayName: string } }> = [];
  for (let attempt = 1; personas.length === 0 && attempt <= 40; attempt++) {
    const response = await api.get('/api/auth/dev/personas');
    if (response.ok()) personas = await response.json();
    else await new Promise((r) => setTimeout(r, 1500));
  }
  const me = personas.find((p) => p.person.displayName === OBSERVER);
  expect(me, `persona ${OBSERVER} not seeded`).toBeTruthy();
  const signIn = await api.post('/api/auth/dev/sign-in', {
    headers: H,
    data: { personId: me?.person.id },
  });
  expect(signIn.status()).toBe(204);
  await page.context().addCookies((await api.storageState()).cookies);

  /** One capture, tap to receipt, in milliseconds. */
  const capture = async () => {
    await apiReady(page);
    await page.goto('/');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.waitForLoadState('networkidle');

    // Tap: the centre tab-bar button, always in the same place on a phone.
    const started = Date.now();
    await page.getByRole('button', { name: /^I saw this/ }).tap();

    // Who: the first chip is the most likely person.
    const who = page.getByRole('region', { name: 'Who' });
    await who.getByRole('button').first().waitFor();
    await think(page, 1200);
    await who.getByRole('button').first().tap();

    // Skills default to the plan's focus skill; read the ladder, pick a level.
    const ladder = page.getByRole('radiogroup').first();
    await ladder.getByRole('radio').nth(2).waitFor();
    await expect(ladder.getByRole('radio').nth(2)).not.toHaveText(/^3Doing independently$/);
    await think(page, 1800);
    await ladder.getByRole('radio').nth(2).tap();

    // What I saw, then the next step, by dictation.
    await think(page, 1500);
    await page.getByLabel('What I saw').tap();
    await page.getByLabel('What I saw').pressSequentially(SAW, { delay: MS_PER_CHAR });
    await think(page, 1000);
    await page.getByLabel('What next').tap();
    await page.getByLabel('What next').pressSequentially(NEXT, { delay: MS_PER_CHAR });

    // Sign, read the statement, confirm. Signing is never optimistic.
    await think(page, 600);
    await page.getByRole('button', { name: 'Sign', exact: true }).tap();
    await page.getByRole('dialog').waitFor();
    await think(page, 1200);
    await page.getByRole('button', { name: 'Sign observation' }).tap();
    await page.getByRole('heading', { name: 'Signed.' }).waitFor({ timeout: 30_000 });
    return Date.now() - started;
  };

  // A shared dev API restarts when anyone edits server code. A run that fails
  // in transit is logged and replaced (at most MAX_ABORTS), and the count is
  // reported, never hidden.
  const MAX_ABORTS = 5;
  const times: Array<number> = [];
  let aborted = 0;
  while (times.length < RUNS) {
    try {
      const elapsed = await capture();
      times.push(elapsed);
      console.log(`run ${times.length}: ${(elapsed / 1000).toFixed(1)} s`);
    } catch (error) {
      aborted++;
      console.log(`aborted (${aborted}): ${String(error).split('\n')[0]}`);
      if (aborted > MAX_ABORTS) throw error;
    }
  }

  const result = {
    observer: OBSERVER,
    runs: RUNS,
    abortedRuns: aborted,
    dictationMsPerChar: MS_PER_CHAR,
    charactersEntered: SAW.length + NEXT.length,
    secondsEach: times.map((t) => Math.round(t / 100) / 10),
    medianSeconds: Math.round(median(times) / 100) / 10,
  };
  console.log(`median of ${RUNS}: ${result.medianSeconds} s`);
  await info.attach('capture-timing.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(median(times), 'median tap-to-signed within the 60 second budget').toBeLessThanOrEqual(
    BUDGET_MS,
  );
});
