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

const MODELS_DIR = 'packages/api/src/models';

/**
 * The model files of packages/api/src/models: which file exports each schema,
 * and which other model files each one imports (`./x.ts`).
 */
const apiModels = () => {
  const fileOf = new Map();
  const imports = new Map();
  for (const file of walk(MODELS_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('index.ts'))) {
    const text = read(file);
    for (const m of text.matchAll(/export const (\w+)\s*=/g)) fileOf.set(m[1], file);
    imports.set(
      file,
      [...text.matchAll(/from '\.\/([\w-]+)\.ts'/g)].map((m) => `${MODELS_DIR}/${m[1]}.ts`),
    );
  }
  return { fileOf, imports };
};

/** The model files a piece of source names, with the model files those import. */
const modelFilesIn = (text, { fileOf, imports }) => {
  const files = new Set();
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    for (const next of imports.get(file) ?? []) visit(next);
  };
  for (const m of text.matchAll(/\b[A-Z]\w*\b/g)) if (fileOf.has(m[0])) visit(fileOf.get(m[0]));
  return [...files].toSorted();
};

/**
 * API groups and endpoints from packages/api/src/groups: a map from group name
 * to `{ file, endpoints: Map<name, 'METHOD /api/path'>, models: Map<name,
 * model files> }`. An endpoint's model files are those defining the schemas
 * its declaration names (payload, success, errors), and what they import, so a
 * change to a model routes to the features whose endpoints carry it.
 */
export const apiGroups = () => {
  const models = apiModels();
  const groups = new Map();
  for (const file of walk('packages/api/src/groups').filter((f) => f.endsWith('.ts'))) {
    // A file may declare more than one group; split it at each declaration.
    const parts = read(file).split(/(?=HttpApiGroup\.make\()/);
    for (const part of parts) {
      const name = part.match(/^HttpApiGroup\.make\('([^']+)'\)/)?.[1];
      if (!name) continue;
      const prefix = part.match(/\.prefix\('([^']+)'\)/)?.[1] ?? '';
      const endpoints = new Map();
      const endpointModels = new Map();
      for (const block of part.split(/(?=HttpApiEndpoint\.)/)) {
        const m = block.match(
          /^HttpApiEndpoint\.(get|post|put|patch|delete)\(\s*'([^']+)',\s*'([^']+)'/,
        );
        if (!m) continue;
        endpoints.set(m[2], `${m[1].toUpperCase()} /api${prefix}${m[3]}`);
        endpointModels.set(m[2], modelFilesIn(block, models));
      }
      groups.set(name, { file, endpoints, models: endpointModels });
    }
  }
  return groups;
};

/**
 * Migrations (packages/db/drizzle/<migration>/) and the schema tables each
 * one's SQL creates, alters, indexes, triggers on or reads, so a migration routes to the features
 * that claim those tables.
 */
export const migrations = () => {
  const known = tables();
  const out = new Map();
  for (const file of walk('packages/db/drizzle').filter((f) => f.endsWith('/migration.sql'))) {
    const tablesTouched = new Set(
      [...read(file).matchAll(/\b(?:TABLE|ON|INTO|UPDATE|REFERENCES|FROM|JOIN)\s+"?([a-z_]+)"?/gi)]
        .map((m) => m[1])
        .filter((t) => known.has(t)),
    );
    out.set(file.slice(0, -'/migration.sql'.length), tablesTouched);
  }
  return out;
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

/** Each app's and package's `src` directory. */
const sourceDirs = () =>
  ['apps', 'packages'].flatMap((top) =>
    existsSync(join(ROOT, top))
      ? readdirSync(join(ROOT, top))
          .map((name) => join(top, name, 'src'))
          .filter((dir) => existsSync(join(ROOT, dir)))
      : [],
  );

/**
 * Every Vitest file in the workspace (`*.test.ts(x)` under each app's and
 * package's `src`): scenario, domain, integrity, unit and web tests alike.
 * Playwright specs under `apps/web/e2e` are run by the browser kind, not here.
 */
export const testSources = () =>
  sourceDirs()
    .flatMap(walk)
    .filter((f) => /\.test\.tsx?$/.test(f));

/**
 * Every product source file a feature must own: code and styles under each
 * app's and package's `src` (tests are counted by `testSources`), and every
 * migration directory under packages/db/drizzle.
 */
export const productSources = () => [
  ...sourceDirs()
    .flatMap(walk)
    .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f)),
  ...migrations().keys(),
];

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
