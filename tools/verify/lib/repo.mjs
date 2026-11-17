// Facts read from the repository's own sources, so the map is checked against
// the code rather than against itself. Plain text parsing; no install needed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './paths.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** Files under a directory (recursive), as repository-relative paths. */
export const walk = (dir) => {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true })
    .map((entry) => join(dir, String(entry)))
    .filter((path) => statSync(join(ROOT, path)).isFile())
    .toSorted();
};

/**
 * API groups and endpoints from packages/api/src/groups: a map from group name
 * to `{ file, endpoints: Map<name, 'METHOD /api/path'> }`.
 */
export const apiGroups = () => {
  const groups = new Map();
  for (const file of walk('packages/api/src/groups').filter((f) => f.endsWith('.ts'))) {
    // A file may declare more than one group; split it at each declaration.
    const parts = read(file).split(/(?=HttpApiGroup\.make\()/);
    for (const part of parts) {
      const name = part.match(/^HttpApiGroup\.make\('([^']+)'\)/)?.[1];
      if (!name) continue;
      const prefix = part.match(/\.prefix\('([^']+)'\)/)?.[1] ?? '';
      const endpoints = new Map();
      for (const m of part.matchAll(
        /HttpApiEndpoint\.(get|post|put|patch|delete)\(\s*'([^']+)',\s*'([^']+)'/g,
      ))
        endpoints.set(m[2], `${m[1].toUpperCase()} /api${prefix}${m[3]}`);
      groups.set(name, { file, endpoints });
    }
  }
  return groups;
};

/** Table names declared with pgTable in packages/db/src/schema. */
export const tables = () =>
  new Set(
    walk('packages/db/src/schema').flatMap((file) =>
      [...read(file).matchAll(/pgTable\(\s*'([a-z_]+)'/g)].map((m) => m[1]),
    ),
  );

/** Route files of the web app (TanStack file routes). */
export const webRoutes = () =>
  walk('apps/web/src/routes').filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.gen.ts'));

/**
 * Every Vitest file in the workspace (`*.test.ts(x)` under each app's and
 * package's `src`): scenario, domain, integrity, unit and web tests alike.
 * Playwright specs under `apps/web/e2e` are run by the browser kind, not here.
 */
export const testSources = () =>
  ['apps', 'packages']
    .flatMap((top) =>
      existsSync(join(ROOT, top))
        ? readdirSync(join(ROOT, top)).map((name) => join(top, name, 'src'))
        : [],
    )
    .flatMap(walk)
    .filter((f) => /\.test\.tsx?$/.test(f));

/** Display names of seeded people (the story world and the practice cohort's named people). */
export const seedPersonas = () => {
  const names = new Set();
  for (const file of walk('apps/server/src/scripts').filter((f) => f.endsWith('.ts'))) {
    const text = read(file);
    for (const m of text.matchAll(/\bname: '([A-Z][a-z]+ [A-Z][A-Za-z]+)'/g)) names.add(m[1]);
  }
  return names;
};

const SCREENSHOT_SPEC = 'apps/web/e2e/screenshots.spec.ts';

/** Personas and route names the screenshot spec knows (its PERSONAS list and route table). */
export const screenshotSpec = () => {
  const text = read(SCREENSHOT_SPEC);
  const list = text.match(/const PERSONAS = \[([^\]]*)\]/)?.[1] ?? '';
  const personas = new Set([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const routes = new Set([...text.matchAll(/\[\s*'([a-z-]+)',\s*['`]\//g)].map((m) => m[1]));
  return { file: SCREENSHOT_SPEC, personas, routes };
};

/** Workspace packages by name, with their directory and scripts. */
export const workspacePackages = () => {
  const packages = new Map();
  for (const base of ['apps', 'packages', 'tools']) {
    for (const dir of readdirSync(join(ROOT, base))) {
      const path = join(base, dir, 'package.json');
      if (!existsSync(join(ROOT, path))) continue;
      const pkg = JSON.parse(read(path));
      packages.set(pkg.name, { dir: join(base, dir), scripts: pkg.scripts ?? {} });
    }
  }
  return packages;
};

export const rootScripts = () => JSON.parse(read('package.json')).scripts ?? {};

/** The package that owns a repository path (its nearest package.json below the root). */
export const packageOf = (path, packages = workspacePackages()) => {
  for (const [name, pkg] of packages)
    if (!relative(pkg.dir, path).startsWith('..')) return { name, ...pkg };
  return null;
};

/** GitHub-style heading anchors of a Markdown file. */
export const anchors = (path) => {
  const seen = new Map();
  const out = new Set();
  let fence = false;
  for (const line of read(path).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = !fence && line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!heading) continue;
    const base = heading[1]
      .toLowerCase()
      .replaceAll(/`/g, '')
      .replaceAll(/[^\p{Letter}\p{Number}\s_-]/gu, '')
      .trim()
      .replaceAll(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
};

export const exists = (path) => existsSync(join(ROOT, path));
export const readText = read;
