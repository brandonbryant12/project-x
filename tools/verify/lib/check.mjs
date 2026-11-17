// `pnpm verify check`: the feature map's staleness check. It fails, naming the
// entry and the problem, when the map cites something that does not exist,
// when the product has a route, endpoint, test file, playbook or journey check
// that no feature claims, when a command cited in the map or in an agent
// skill does not exist, or when the generated README is out of date. Plain
// Node and the repository's files only, so CI runs it without an install.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXPLAINED_STATES,
  README_PATH,
  RUN_KINDS,
  STATES,
  TEST_KINDS,
  UNBUILT_STATES,
  journeyPath,
  loadMap,
  testFiles,
} from './map.mjs';
import { ROOT } from './paths.mjs';
import { renderReadme } from './readme.mjs';
import {
  anchors,
  apiGroups,
  exists,
  readText,
  rootScripts,
  screenshotSpec,
  seedPersonas,
  tables,
  testSources,
  walk,
  webRoutes,
  workspacePackages,
} from './repo.mjs';

const SUBCOMMANDS = ['list', 'show', 'which', 'check', 'readme', 'run', 'env'];
const ENV_ACTIONS = ['build', 'seed', 'start', 'stop', 'status'];
const PLAYBOOK_DIR = '.claude/skills/qa/journeys';
const JOURNEY_DIR = 'tools/verify/journeys';
const JOURNEY_HELPERS = new Set(['harness.mjs', 'common.mjs']);

/** Problems with `pnpm verify <sub> ...` arguments, or null. */
const verifyArgsProblem = (args, ctx) => {
  const [sub, ...rest] = args;
  if (sub === undefined || sub.startsWith('-')) return null;
  if (!SUBCOMMANDS.includes(sub)) return `pnpm verify has no command "${sub}"`;
  if (sub === 'env' && !ENV_ACTIONS.includes(rest[0]))
    return `pnpm verify env has no action "${rest[0]}"`;
  const kindAt = rest.indexOf('--kind');
  if (kindAt >= 0 && rest[kindAt + 1] !== undefined) {
    const bad = rest[kindAt + 1].split(',').find((k) => !RUN_KINDS.includes(k));
    if (bad !== undefined) return `pnpm verify run has no kind "${bad}"`;
  }
  if (sub !== 'show' && sub !== 'run') return null;
  const ids = [];
  for (let k = 0; k < rest.length; k++) {
    if (!rest[k].startsWith('--')) ids.push(rest[k]);
    else if (!['--json', '--strict'].includes(rest[k])) k++;
  }
  const unknown = ids.find((id) => !ctx.ids.has(id));
  return unknown === undefined ? null : `no feature "${unknown}"`;
};

/**
 * Checks one command line as written in the map or a skill. Returns a problem
 * or null. Only pnpm commands are checked; placeholders (`<id>`) are allowed.
 */
export const commandProblem = (line, ctx) => {
  const tokens = line.trim().split(/\s+/);
  while (tokens.length > 0 && /^[A-Z_][A-Z0-9_]*=/.test(tokens[0])) tokens.shift();
  if (tokens[0] !== 'pnpm') return null;
  let i = 1;
  let scripts = ctx.root;
  let dir = '.';
  if (tokens[i] === '--filter') {
    const pkg = ctx.packages.get(tokens[i + 1]);
    if (!pkg) return `no workspace package ${tokens[i + 1]}`;
    scripts = pkg.scripts;
    dir = pkg.dir;
    i += 2;
  }
  while (tokens[i]?.startsWith('-')) i++;
  const script = tokens[i];
  if (script === undefined) return 'no script named';
  if (script === 'exec') {
    // Binaries exist only after an install; CI's docs job runs without one.
    const bin = tokens[i + 1];
    if (!existsSync(join(ROOT, 'node_modules')) || !bin || bin.includes('<')) return null;
    const found = [dir, '.'].some((d) => existsSync(join(ROOT, d, 'node_modules/.bin', bin)));
    return found ? null : `no binary ${bin} in ${dir}`;
  }
  if (!(script in scripts)) return `no package script "${script}" in ${dir}/package.json`;
  if (script !== 'verify' || dir !== '.') return null;
  return verifyArgsProblem(
    tokens.slice(i + 1).filter((a) => !a.includes('<') && !a.includes('|')),
    ctx,
  );
};

/** `pnpm ...` command lines in a Markdown file: backticked spans and fenced blocks. */
const commandsIn = (path) => {
  const found = [];
  let fence = false;
  readText(path)
    .split('\n')
    .forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fence = !fence;
        return;
      }
      const candidates = fence
        ? [line.replace(/\s+#.*$/, '')]
        : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      for (const c of candidates)
        if (/^\s*(?:[A-Z_]+=\S+\s+)*pnpm\s/.test(c))
          found.push({ line: index + 1, command: c.trim() });
    });
  return found;
};

const checkState = (feature, problem) => {
  if (!STATES.includes(feature.state)) problem(`state must be one of ${STATES.join(', ')}`);
  if (EXPLAINED_STATES.includes(feature.state)) {
    if (!feature.reason) problem(`state ${feature.state} needs a reason`);
    if (!feature.recordedIn) problem(`state ${feature.state} needs recordedIn (the document)`);
  }
  if (feature.recordedIn && !exists(feature.recordedIn.split('#')[0]))
    problem(`recordedIn does not exist: ${feature.recordedIn}`);
  if (feature.state === 'behind_switch') {
    const config = readText('apps/server/src/platform/config.ts');
    if (!feature.switch || !config.includes(`'${feature.switch}'`))
      problem(`switch ${feature.switch} is not read in apps/server/src/platform/config.ts`);
  }
};

const checkCode = (feature, ctx, problem) => {
  const code = feature.code ?? {};
  for (const key of ['web', 'server', 'domain', 'other'])
    for (const path of code[key] ?? [])
      if (!exists(path)) problem(`code.${key}: no such path ${path}`);
  for (const endpoint of code.api ?? []) {
    const [group, name] = endpoint.split('.');
    if (!ctx.groups.get(group)?.endpoints.has(name))
      problem(`code.api: no endpoint ${endpoint} in packages/api/src/groups`);
  }
  for (const table of code.tables ?? [])
    if (!ctx.tables.has(table)) problem(`code.tables: no table ${table} in packages/db/src/schema`);
};

const checkGuidance = (feature, ctx, problem) => {
  for (const kind of Object.keys(feature.tests ?? {}))
    if (!TEST_KINDS.includes(kind))
      problem(`tests.${kind}: kind must be one of ${TEST_KINDS.join(', ')}`);
  for (const path of testFiles(feature)) if (!exists(path)) problem(`tests: no such file ${path}`);
  for (const path of feature.skills ?? [])
    if (!exists(path)) problem(`skills: no such file ${path}`);
  if (feature.qa) {
    const [path, anchor] = feature.qa.split('#');
    if (!exists(path)) problem(`qa: no such playbook ${path}`);
    else if (anchor && !anchors(path).has(anchor)) problem(`qa: no heading #${anchor} in ${path}`);
  }
  for (const name of feature.personas ?? [])
    if (!ctx.personas.has(name)) problem(`personas: "${name}" is not a seeded person`);
};

const checkVerify = (feature, ctx, problem) => {
  const v = feature.verify ?? {};
  if (UNBUILT_STATES.includes(feature.state)) {
    if (v.api?.length || v.browser || v.commands?.length)
      problem(`state ${feature.state} must have no verify commands`);
  } else {
    if (testFiles(feature).length === 0) problem('a built feature needs at least one test');
    if (!feature.qa) problem('a built feature needs a qa playbook');
  }
  for (const name of v.api ?? []) {
    const path = journeyPath(name);
    if (!exists(path)) problem(`verify.api: no journey ${path}`);
    else if (!readText(path).includes(`name: '${name}'`))
      problem(`verify.api: ${path} does not declare name: '${name}'`);
  }
  for (const name of v.browser?.personas ?? [])
    if (!ctx.spec.personas.has(name))
      problem(`verify.browser: persona "${name}" is not in ${ctx.spec.file} PERSONAS`);
  for (const route of v.browser?.routes ?? [])
    if (!ctx.spec.routes.has(route))
      problem(`verify.browser: route "${route}" is not one ${ctx.spec.file} captures`);
  for (const command of v.commands ?? []) {
    const p = commandProblem(command, ctx);
    if (p) problem(`verify.commands: ${command}: ${p}`);
  }
};

/** Product surface that some feature must claim. */
const checkCoverage = (map, ctx, fail) => {
  const claimed = (pick) => new Set(map.features.flatMap(pick));
  const routes = claimed((f) => f.code?.web ?? []);
  for (const route of webRoutes())
    if (!routes.has(route)) fail('coverage', `web route ${route} is claimed by no feature`);
  const endpoints = claimed((f) => f.code?.api ?? []);
  for (const [group, { endpoints: names }] of ctx.groups)
    for (const name of names.keys())
      if (!endpoints.has(`${group}.${name}`))
        fail('coverage', `API endpoint ${group}.${name} is claimed by no feature`);
  const tests = claimed(testFiles);
  for (const test of testSources())
    if (!tests.has(test)) fail('coverage', `test ${test} is claimed by no feature`);
  const playbooks = claimed((f) => (f.qa ? [f.qa.split('#')[0]] : []));
  for (const path of walk(PLAYBOOK_DIR).filter((p) => p.endsWith('.md')))
    if (!playbooks.has(path)) fail('coverage', `playbook ${path} is cited by no feature`);
  const journeys = claimed((f) => (f.verify?.api ?? []).map(journeyPath));
  for (const path of walk(JOURNEY_DIR).filter((p) => p.endsWith('.mjs')))
    if (!JOURNEY_HELPERS.has(path.split('/').at(-1)) && !journeys.has(path))
      fail('coverage', `journey check ${path} is run by no feature`);
};

export const runCheck = () => {
  const failures = [];
  const fail = (where, detail) => failures.push({ where, detail });
  let map;
  try {
    map = loadMap();
  } catch (error) {
    fail('features.json', `cannot be read: ${error.message}`);
    return { failures, features: 0 };
  }
  const ctx = {
    groups: apiGroups(),
    tables: tables(),
    personas: seedPersonas(),
    spec: screenshotSpec(),
    root: rootScripts(),
    packages: workspacePackages(),
    ids: new Set(map.features.map((f) => f.id)),
  };
  const seen = new Set();
  for (const feature of map.features) {
    const problem = (detail) => fail(feature.id ?? '(no id)', detail);
    if (seen.has(feature.id)) problem('id used twice');
    seen.add(feature.id);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id ?? '')) problem('id must be kebab-case');
    for (const field of ['name', 'summary']) if (!feature[field]) problem(`missing ${field}`);
    checkState(feature, problem);
    checkCode(feature, ctx, problem);
    checkGuidance(feature, ctx, problem);
    checkVerify(feature, ctx, problem);
  }
  checkCoverage(map, ctx, fail);

  // Commands that agent instructions and the generated README tell an agent to run.
  const docs = [...walk('.claude/skills').filter((p) => p.endsWith('.md')), README_PATH];
  for (const path of docs.filter(exists))
    for (const { line, command } of commandsIn(path)) {
      const p = commandProblem(command, ctx);
      if (p) fail(`${path}:${line}`, `${command}: ${p}`);
    }

  if (!exists(README_PATH) || readText(README_PATH) !== renderReadme(map, ctx.groups))
    fail(README_PATH, 'out of date with features.json; run `pnpm verify readme`');
  return { failures, features: map.features.length };
};

export const checkCommand = ({ json }) => {
  const { failures, features } = runCheck();
  if (json) {
    const report = { ok: failures.length === 0, features, failures };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (failures.length === 0) {
    process.stdout.write(`verify check passed (${features} features).\n`);
  } else {
    for (const f of failures) process.stderr.write(`${f.where}  ${f.detail}\n`);
    process.stderr.write(
      `\nverify check failed: ${failures.length} problem(s) in ${features} features.\n`,
    );
  }
  return failures.length === 0 ? 0 : 1;
};
