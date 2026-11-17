import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const PERSONAS = [
  'Maya Chen',
  'Leo Okonkwo',
  'Sam Rivera',
  'Aisha Bello',
  'Rhea Castillo',
  'Grace Liu',
  'Nadia Brooks',
];
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;
const THEMES = ['light', 'dark'] as const;
/** Widths the layout must hold at without horizontal scrolling (path-to-A, UX). */
const OVERFLOW_WIDTHS = [360, 390, 768, 1280] as const;
/** `CHECK=screens` or `CHECK=overflow` runs one half; the default runs both. */
const check = process.env['CHECK'];

const pick = <T extends string>(env: string | undefined, all: ReadonlyArray<T>) =>
  env
    ? all.filter((x) =>
        env
          .split(',')
          .map((s) => s.trim())
          .includes(x),
      )
    : all;

const personas = pick(process.env['PERSONAS'], PERSONAS);
const themes = pick(process.env['THEMES'], THEMES);
const viewports = pick(
  process.env['VIEWPORTS'],
  Object.keys(VIEWPORTS) as Array<keyof typeof VIEWPORTS>,
);
const routeFilter = process.env['ROUTES']?.split(',');

const H = { 'x-requested-with': 'fetch' };
const slug = (s: string) => s.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

/** GET JSON, waiting out a dev API restart (watch mode) rather than failing the run. */
const getJson = async (api: APIRequestContext, path: string) => {
  for (let attempt = 1; ; attempt++) {
    const response = await api.get(path, { headers: H });
    if (response.ok()) return response.json();
    if (attempt >= 20) throw new Error(`${path} answered ${response.status()}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
};

/** Resolve the routes worth looking at for this persona, using the API itself. */
const routesFor = async (
  api: APIRequestContext,
  personId: string,
): Promise<Array<[string, string]>> => {
  const get = (path: string) => getJson(api, `/api${path}`);
  const routes: Array<[string, string]> = [
    ['home', '/'],
    ['development', '/development'],
    ['inbox', '/inbox'],
    ['profile', `/people/${personId}`],
    ['skills', '/catalog/skills'],
    ['skill', '/catalog/skills/client-discovery'],
    ['people', '/people'],
    ['team', '/team'],
    ['coaching', '/coaching'],
    ['observe-new', '/observations/new'],
    ['settings', '/settings'],
  ];
  const inbox = await get('/observations/inbox');
  const first = inbox.requests?.[0] ?? inbox.drafts?.[0] ?? inbox.mine?.[0] ?? inbox.signed?.[0];
  if (first) routes.push(['observation', `/observations/${first.id}`]);
  const profile = await get(`/people/${personId}`);
  const badge = profile.badges?.[0];
  if (badge) routes.push(['badge-receipt', `/people/${personId}/badges/${badge.id}`]);
  // Oversight screens only for the grants that may open them.
  const grants: ReadonlyArray<string> = (await get('/session')).grants ?? [];
  const has = (g: string) => grants.includes(g);
  if (has('tenant_admin') || has('compliance_reviewer')) {
    routes.push(['admin-ai-usage', '/admin/ai-usage'], ['admin-audit', '/admin/audit']);
  }
  if (has('tenant_admin') || has('program_owner')) {
    routes.push(
      ['adoption', '/adoption'],
      ['credit-rules', '/program/credit-rules'],
      ['program-skills', '/program/skills'],
      ['program-skill', '/program/skills/client-discovery'],
      ['program-templates', '/program/templates'],
    );
    const templates = await get('/program/activity-templates');
    if (templates[0]) routes.push(['program-template', `/program/templates/${templates[0].id}`]);
  }
  return routeFilter ? routes.filter(([name]) => routeFilter.includes(name)) : routes;
};

const settle = async (page: Page) => {
  await page.locator('#root > *').first().waitFor({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(250);
};

/** Sign in as a seeded persona; returns the API context and its cookies. */
const signIn = async (
  playwright: { request: { newContext: (o: { baseURL: string }) => Promise<APIRequestContext> } },
  persona: string,
) => {
  const api = await playwright.request.newContext({
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:5400',
  });
  const seeded = await getJson(api, '/api/auth/dev/personas');
  const match = seeded.find(
    (p: { person: { displayName: string } }) => p.person.displayName === persona,
  );
  expect(match, `persona ${persona} not seeded`).toBeTruthy();
  const response = await api.post('/api/auth/dev/sign-in', {
    headers: H,
    data: { personId: match.person.id },
  });
  expect(response.status()).toBe(204);
  const routes = await routesFor(api, match.person.id);
  const cookies = (await api.storageState()).cookies;
  return { routes, cookies };
};

/**
 * The widest elements that stick out past the viewport, deepest first, so a
 * failure names the culprit rather than just the page.
 */
const overflowReport = (page: Page) =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const scroll = document.documentElement.scrollWidth;
    if (scroll <= vw) return null;
    const offenders: Array<string> = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 0.5) continue;
      // Skip ancestors of an offender already listed: report the leaf.
      if (Array.from(el.children).some((c) => c.getBoundingClientRect().right > vw + 0.5)) continue;
      const cls = typeof el.className === 'string' ? el.className.slice(0, 80) : '';
      const text = (el.textContent ?? '').trim().slice(0, 40);
      offenders.push(
        `<${el.tagName.toLowerCase()} class="${cls}"> "${text}" right=${Math.round(r.right)}`,
      );
      if (offenders.length >= 4) break;
    }
    return { scroll, vw, offenders };
  });

for (const persona of personas) {
  test(`overflow · ${persona}`, async ({ browser, playwright }) => {
    test.skip(check === 'screens', 'CHECK=screens');
    const { routes, cookies } = await signIn(playwright, persona);
    for (const width of OVERFLOW_WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      await context.addCookies(cookies);
      const page = await context.newPage();
      for (const [name, path] of routes) {
        await page.goto(path);
        await settle(page);
        const report = await overflowReport(page);
        expect
          .soft(
            report,
            `${persona} · ${name} at ${width}px scrolls sideways to ${report?.scroll}px:\n  ${report?.offenders.join('\n  ')}`,
          )
          .toBeNull();
      }
      await context.close();
    }
  });

  test(`screens · ${persona}`, async ({ browser, playwright }) => {
    test.skip(check === 'overflow', 'CHECK=overflow');
    const { routes, cookies } = await signIn(playwright, persona);
    for (const theme of themes) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: VIEWPORTS[viewport],
          colorScheme: theme,
        });
        await context.addCookies(cookies);
        const page = await context.newPage();
        page.on('pageerror', (e) => console.log(`[${persona}] pageerror: ${e.message}`));
        page.on(
          'console',
          (m) => m.type() === 'error' && console.log(`[${persona}] console: ${m.text()}`),
        );
        for (const [name, path] of routes) {
          await page.goto(path);
          await settle(page);
          await page.screenshot({
            path: `screenshots/${slug(persona)}/${name}-${theme}-${viewport}.png`,
            fullPage: true,
          });
        }
        await context.close();
      }
    }
  });
}
