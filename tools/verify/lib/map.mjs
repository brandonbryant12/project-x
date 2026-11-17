// Loads docs/feature-map/features.json and derives what the other commands need:
// the paths a feature claims, and the exact commands that verify it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

export const MAP_PATH = 'docs/feature-map/features.json';
export const README_PATH = 'docs/feature-map/README.md';
export const STATES = ['built', 'behind_switch', 'api_only', 'deferred', 'not_built'];
/** States that are not (fully) built and must say why, and where that is recorded. */
export const EXPLAINED_STATES = ['behind_switch', 'api_only', 'deferred', 'not_built'];
/** States that have no running code to verify. */
export const UNBUILT_STATES = ['deferred', 'not_built'];
export const TEST_KINDS = ['domain', 'scenario', 'integrity', 'unit', 'web'];
export const RUN_KINDS = ['tests', 'api', 'browser'];

export const loadMap = () => JSON.parse(readFileSync(join(ROOT, MAP_PATH), 'utf8'));

export const findFeature = (map, id) => map.features.find((f) => f.id === id);

/** Every test file a feature lists, of every kind. */
export const testFiles = (feature) => TEST_KINDS.flatMap((kind) => feature.tests?.[kind] ?? []);

/** The API journey modules a feature runs (tools/verify/journeys/<name>.mjs). */
export const journeyPath = (name) => `tools/verify/journeys/${name}.mjs`;

/** The API group file that declares `group.endpoint`. */
export const apiGroupFile = (endpoint, groups) => groups.get(endpoint.split('.')[0])?.file;

/**
 * Repository paths a feature claims, for `which`: its code, tests, playbook and
 * journey checks. API endpoints map to their group file.
 */
export const claimedPaths = (feature, groups = new Map()) => {
  const code = feature.code ?? {};
  return [
    ...(code.web ?? []),
    ...(code.server ?? []),
    ...(code.domain ?? []),
    ...(code.other ?? []),
    ...(code.api ?? []).map((e) => apiGroupFile(e, groups)).filter(Boolean),
    ...testFiles(feature),
    ...(feature.qa ? [feature.qa.split('#')[0]] : []),
    ...(feature.verify?.api ?? []).map(journeyPath),
  ];
};

const quote = (s) => (/\s/.test(s) ? `"${s}"` : s);

/** The exact commands that exercise a feature, in the order an agent should run them. */
export const commandsFor = (feature) => {
  const v = feature.verify ?? {};
  const commands = [];
  if (testFiles(feature).length > 0)
    commands.push({ kind: 'tests', command: `pnpm verify run ${feature.id} --kind tests` });
  if ((v.api ?? []).length > 0)
    commands.push({ kind: 'api', command: `pnpm verify run ${feature.id} --kind api` });
  if (v.browser)
    commands.push({ kind: 'browser', command: `pnpm verify run ${feature.id} --kind browser` });
  for (const command of v.commands ?? []) commands.push({ kind: 'other', command });
  return commands;
};

/** The screenshot spec's environment for a feature's browser check. */
export const browserEnv = (feature) => ({
  PERSONAS: feature.verify.browser.personas.join(','),
  ROUTES: feature.verify.browser.routes.join(','),
});

export const describeBrowser = (feature) =>
  feature.verify?.browser
    ? `routes ${feature.verify.browser.routes.join(', ')} as ${feature.verify.browser.personas
        .map(quote)
        .join(', ')}`
    : null;
