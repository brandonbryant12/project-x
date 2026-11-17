// `pnpm verify run <id...> [--kind tests|api|browser] [--out <dir>] [--strict] [--workers 1]`
//
// Runs the selected kinds of check for the given features and writes one run
// directory: result.json (structured, for agents), summary.md (for people) and
// the artifacts (Vitest and Playwright reports, logs, screenshots). Every check
// ends as passed, failed, skipped (with the reason) or error. The process
// exits 1 when any check failed or errored (and, with --strict, was skipped).
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { qaSettings, ready } from './env.mjs';
import { RUN_KINDS, browserEnv, findFeature, journeyPath, loadMap, testFiles } from './map.mjs';
import { ROOT, pnpm } from './paths.mjs';
import { packageOf, workspacePackages } from './repo.mjs';
import { runJourney } from '../journeys/harness.mjs';

const REVIEW_NOTE =
  'Screenshots are rendered evidence only: open them and judge them against apps/web/DESIGN.md before calling the UI verified.';

const slug = (s) => s.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
const log = (text) => process.stderr.write(`${text}\n`);

/** Runs a command, writing its output to a log file; returns the exit status. */
const runLogged = (command, commandArgs, { cwd, env, logFile }) => {
  const [bin, args] = command === 'pnpm' ? pnpm(commandArgs) : [command, commandArgs];
  const result = spawnSync(bin, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(
    logFile,
    `$ ${command} ${commandArgs.join(' ')}\n\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  );
  return result.status ?? 1;
};

const testsKind = (features, dir, workers) => {
  const packages = workspacePackages();
  const files = [...new Set(features.flatMap(testFiles))];
  const results = new Map();
  const byPackage = new Map();
  for (const file of files) {
    const pkg = packageOf(file, packages);
    if (!pkg) {
      results.set(file, { status: 'error', reason: 'no workspace package owns this file' });
      continue;
    }
    byPackage.set(pkg.name, [...(byPackage.get(pkg.name) ?? []), { file, pkg }]);
  }
  for (const [name, entries] of byPackage) {
    const pkgDir = entries[0].pkg.dir;
    const report = join(dir, `vitest-${slug(name)}.json`);
    const logFile = join(dir, `vitest-${slug(name)}.log`);
    log(`tests: ${name}: ${entries.length} file(s)`);
    const status = runLogged(
      'pnpm',
      [
        '--filter',
        name,
        'exec',
        'vitest',
        'run',
        ...entries.map((e) => relative(pkgDir, e.file)),
        `--maxWorkers=${workers}`,
        '--reporter=json',
        `--outputFile=${report}`,
      ],
      { cwd: ROOT, logFile },
    );
    const parsed = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
    for (const { file } of entries) {
      const found = parsed?.testResults?.find((r) => resolve(r.name) === resolve(ROOT, file));
      if (!found) {
        results.set(file, {
          status: 'error',
          reason: `Vitest reported no result (exit ${status}); see ${logFile}`,
          artifacts: [logFile],
        });
        continue;
      }
      const assertions = found.assertionResults ?? [];
      const failed = assertions.filter((a) => a.status === 'failed');
      results.set(file, {
        status: found.status === 'passed' ? 'passed' : 'failed',
        reason:
          found.status === 'passed'
            ? undefined
            : failed
                .map((a) => `${a.fullName}: ${(a.failureMessages ?? []).join(' ').slice(0, 300)}`)
                .join('; ') || found.message,
        details: { tests: assertions.length, failed: failed.length },
        artifacts: [report, logFile],
      });
    }
  }
  return features.flatMap((f) => {
    const own = testFiles(f);
    if (own.length === 0)
      return [
        {
          feature: f.id,
          kind: 'tests',
          name: '(none)',
          status: 'skipped',
          reason: 'the feature lists no tests',
        },
      ];
    return own.map((file) => ({ feature: f.id, kind: 'tests', name: file, ...results.get(file) }));
  });
};

const apiKind = async (features, dir) => {
  const { baseUrl } = qaSettings();
  const up = await ready(baseUrl);
  const ran = new Map();
  const checks = [];
  for (const f of features) {
    const names = f.verify?.api ?? [];
    if (names.length === 0) {
      checks.push({
        feature: f.id,
        kind: 'api',
        name: '(none)',
        status: 'skipped',
        reason: 'the feature has no API journey check',
      });
      continue;
    }
    for (const name of names) {
      if (!up) {
        checks.push({
          feature: f.id,
          kind: 'api',
          name,
          status: 'skipped',
          reason: `no server answering at ${baseUrl}/readyz; start one with \`pnpm verify env start\``,
        });
        continue;
      }
      if (!ran.has(name)) {
        log(`api: ${name}`);
        const journey = (await import(pathToFileURL(join(ROOT, journeyPath(name))).href)).default;
        const result = await runJourney(journey, baseUrl);
        const file = join(dir, `api-${name}.json`);
        writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
        ran.set(name, { result, file });
      }
      const { result, file } = ran.get(name);
      checks.push({
        feature: f.id,
        kind: 'api',
        name,
        status: result.status,
        ...(result.error && { reason: result.error }),
        details: {
          title: result.title,
          rerunnable: result.rerunnable,
          durationMs: result.durationMs,
          steps: result.steps.map((s) => `${s.status}: ${s.title}`),
        },
        artifacts: [file],
      });
    }
  }
  return { checks, baseUrl };
};

/** Playwright's JSON report flattened to { title: { status, error } }. */
const playwrightResults = (report) => {
  const out = new Map();
  const visit = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        out.set(spec.title, {
          status: last?.status ?? test.status,
          error: last?.error?.message ?? last?.errors?.[0]?.message,
        });
      }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report?.suites ?? []) visit(suite);
  return out;
};

const STATUS = {
  passed: 'passed',
  failed: 'failed',
  timedOut: 'failed',
  skipped: 'skipped',
  interrupted: 'error',
};

const browserKind = async (features, dir) => {
  const s = qaSettings();
  const up = await ready(s.baseUrl);
  const built = existsSync(join(s.webDist, 'index.html'));
  const checks = [];
  for (const f of features) {
    const browser = f.verify?.browser;
    if (!browser) {
      checks.push({
        feature: f.id,
        kind: 'browser',
        name: '(none)',
        status: 'skipped',
        reason: 'the feature has no browser check',
      });
      continue;
    }
    let reason = null;
    if (!up)
      reason = `no server answering at ${s.baseUrl}/readyz; start one with \`pnpm verify env start\``;
    else if (!built) reason = 'no built web app (apps/web/dist); run `pnpm verify env build`';
    if (reason) {
      for (const persona of browser.personas)
        checks.push({
          feature: f.id,
          kind: 'browser',
          name: `screens · ${persona}`,
          status: 'skipped',
          reason,
        });
      continue;
    }
    log(`browser: ${f.id}: ${browser.routes.join(',')} as ${browser.personas.join(', ')}`);
    const report = join(dir, `playwright-${f.id}.json`);
    const logFile = join(dir, `playwright-${f.id}.log`);
    const started = Date.now();
    const status = runLogged(
      'pnpm',
      [
        '--filter',
        '@repo/web',
        'exec',
        'playwright',
        'test',
        '--config',
        'playwright.screenshots.config.ts',
        '--workers=1',
        '--reporter=json',
      ],
      {
        cwd: ROOT,
        logFile,
        env: {
          ...browserEnv(f),
          E2E_BASE_URL: s.baseUrl,
          PLAYWRIGHT_JSON_OUTPUT_NAME: report,
          PLAYWRIGHT_JSON_OUTPUT_FILE: report,
        },
      },
    );
    const results = existsSync(report)
      ? playwrightResults(JSON.parse(readFileSync(report, 'utf8')))
      : new Map();
    for (const persona of browser.personas) {
      const shotsDir = join(ROOT, 'apps/web/screenshots', slug(persona));
      const fresh = existsSync(shotsDir)
        ? readdirSync(shotsDir).filter(
            (n) =>
              n.endsWith('.png') &&
              statSync(join(shotsDir, n)).mtimeMs >= started - 1000 &&
              browser.routes.some((r) => n.startsWith(`${r}-`)),
          )
        : [];
      const copies = fresh.map((n) => {
        const target = join(dir, 'screenshots', slug(persona), n);
        mkdirSync(join(dir, 'screenshots', slug(persona)), { recursive: true });
        copyFileSync(join(shotsDir, n), target);
        return target;
      });
      const missing = browser.routes.filter((r) => !fresh.some((n) => n.startsWith(`${r}-`)));
      const screens = results.get(`screens · ${persona}`);
      let state = screens ? (STATUS[screens.status] ?? 'error') : 'error';
      let why =
        screens?.error ??
        (screens ? undefined : `Playwright reported no result (exit ${status}); see ${logFile}`);
      if (state === 'passed' && missing.length > 0) {
        state = 'failed';
        why = `no screenshot for route(s) ${missing.join(', ')}: the route is not visible to ${persona} or could not be resolved from the seed`;
      }
      checks.push({
        feature: f.id,
        kind: 'browser',
        name: `screens · ${persona}`,
        status: state,
        ...(why && { reason: why }),
        needsReview: copies.length > 0,
        artifacts: [...copies, report, logFile],
      });
      const overflow = results.get(`overflow · ${persona}`);
      checks.push({
        feature: f.id,
        kind: 'browser',
        name: `overflow · ${persona}`,
        status: overflow ? (STATUS[overflow.status] ?? 'error') : 'error',
        ...((overflow?.error || !overflow) && {
          reason:
            overflow?.error ?? `Playwright reported no result (exit ${status}); see ${logFile}`,
        }),
        artifacts: [report, logFile],
      });
    }
  }
  return checks;
};

const tally = (checks) => {
  const out = {};
  for (const kind of RUN_KINDS) {
    const own = checks.filter((c) => c.kind === kind);
    if (own.length === 0) continue;
    out[kind] = { passed: 0, failed: 0, skipped: 0, error: 0 };
    for (const c of own) out[kind][c.status] += 1;
  }
  return out;
};

const EVIDENCE = {
  tests: 'automated',
  api: 'real server, no browser',
  browser: 'rendered (needs a person or agent to look)',
};

const summaryMarkdown = (result) => {
  const lines = [
    `# Verify run ${result.id}`,
    '',
    `- Features: ${result.features.join(', ')}`,
    `- Kinds: ${result.kinds.join(', ')}`,
    `- Commit: ${result.commit}${result.dirty ? ' (with uncommitted changes)' : ''}`,
    `- Server: ${result.baseUrl}`,
    `- Outcome: ${result.ok ? 'no failures' : 'FAILED'}`,
    '',
  ];
  for (const [kind, t] of Object.entries(result.totals))
    lines.push(
      `## ${kind}: ${EVIDENCE[kind]}`,
      '',
      `${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped, ${t.error} error`,
      '',
      ...result.checks
        .filter((c) => c.kind === kind)
        .map(
          (c) =>
            `- ${c.status.toUpperCase()} ${c.feature} · ${c.name}${c.reason ? ` — ${c.reason}` : ''}`,
        ),
      '',
    );
  if (result.screenshots.length > 0)
    lines.push(
      '## Screenshots to inspect',
      '',
      REVIEW_NOTE,
      '',
      ...result.screenshots.map((p) => `- ${p}`),
      '',
    );
  return lines.join('\n');
};

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

export const runCommand = async (ids, flags) => {
  const map = loadMap();
  const unknown = ids.filter((id) => !findFeature(map, id));
  if (ids.length === 0 || unknown.length > 0) {
    process.stderr.write(
      ids.length === 0
        ? 'usage: pnpm verify run <feature-id...> [--kind tests|api|browser]\n'
        : `no feature: ${unknown.join(', ')}\n`,
    );
    return 2;
  }
  const kinds = flags.kind.length > 0 ? flags.kind : RUN_KINDS;
  const badKind = kinds.find((k) => !RUN_KINDS.includes(k));
  if (badKind) {
    process.stderr.write(`no kind "${badKind}"; one of ${RUN_KINDS.join(', ')}\n`);
    return 2;
  }
  const features = ids.map((id) => findFeature(map, id));
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const id = `${stamp}-${slug(ids.join('-')).slice(0, 60)}-${kinds.join('-')}`;
  const dir = resolve(ROOT, flags.out ?? '.data/verify/runs', id);
  mkdirSync(dir, { recursive: true });
  const startedAt = new Date().toISOString();
  const checks = [];
  let baseUrl = qaSettings().baseUrl;
  if (kinds.includes('tests'))
    checks.push(...testsKind(features, dir, flags.workers === '1' ? 1 : 2));
  if (kinds.includes('api')) {
    const api = await apiKind(features, dir);
    checks.push(...api.checks);
    baseUrl = api.baseUrl;
  }
  if (kinds.includes('browser')) checks.push(...(await browserKind(features, dir)));
  const bad = checks.filter(
    (c) =>
      c.status === 'failed' || c.status === 'error' || (flags.strict && c.status === 'skipped'),
  );
  const screenshots = checks
    .filter((c) => c.kind === 'browser')
    .flatMap((c) => (c.artifacts ?? []).filter((a) => a.endsWith('.png')));
  const result = {
    id,
    tool: 'pnpm verify run',
    startedAt,
    finishedAt: new Date().toISOString(),
    commit: git('rev-parse', '--short', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    baseUrl,
    features: ids,
    kinds,
    strict: Boolean(flags.strict),
    ok: bad.length === 0,
    totals: tally(checks),
    evidence: EVIDENCE,
    ...(screenshots.length > 0 && { note: REVIEW_NOTE }),
    screenshots,
    checks,
  };
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(dir, 'summary.md'), summaryMarkdown(result));
  if (flags.json)
    process.stdout.write(
      `${JSON.stringify({ ...result, resultFile: join(dir, 'result.json') }, null, 2)}\n`,
    );
  else {
    process.stdout.write(
      `${summaryMarkdown(result)}\nresult: ${join(dir, 'result.json')}\nsummary: ${join(dir, 'summary.md')}\n`,
    );
  }
  return bad.length === 0 ? 0 : 1;
};
