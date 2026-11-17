// `pnpm verify list | show | which`: find features and choose checks.
import { execFileSync } from 'node:child_process';
import {
  STATES,
  claimedPaths,
  commandsFor,
  describeBrowser,
  findFeature,
  loadMap,
  testFiles,
} from './map.mjs';
import { ROOT } from './paths.mjs';
import { apiGroups } from './repo.mjs';

const out = (text) => process.stdout.write(`${text}\n`);
const json = (value) => out(JSON.stringify(value, null, 2));

export const listCommand = (flags) => {
  const map = loadMap();
  if (flags.state && !STATES.includes(flags.state)) {
    process.stderr.write(`unknown state ${flags.state}; one of ${STATES.join(', ')}\n`);
    return 2;
  }
  const features = map.features.filter(
    (f) =>
      (!flags.state || f.state === flags.state) &&
      (!flags.persona || (f.personas ?? []).includes(flags.persona)),
  );
  const rows = features.map((f) => ({
    id: f.id,
    name: f.name,
    state: f.state,
    personas: f.personas ?? [],
    checks: commandsFor(f).map((c) => c.kind),
  }));
  if (flags.json) json(rows);
  else {
    const width = Math.max(...rows.map((r) => r.id.length), 2);
    for (const r of rows)
      out(
        `${r.id.padEnd(width)}  ${r.state.padEnd(13)}  ${r.name}${r.checks.length ? `  [${r.checks.join(', ')}]` : ''}`,
      );
    out(`\n${rows.length} of ${map.features.length} features. \`pnpm verify show <id>\` for one.`);
  }
  return rows.length > 0 ? 0 : 1;
};

const section = (title, values) => {
  if (!values || values.length === 0) return;
  out(`${title}:`);
  for (const v of values) out(`  ${v}`);
};

export const showCommand = ([id], flags) => {
  const map = loadMap();
  const feature = id && findFeature(map, id);
  if (!feature) {
    process.stderr.write(`no feature "${id ?? ''}"; \`pnpm verify list\` shows them all\n`);
    return 2;
  }
  const groups = apiGroups();
  const commands = commandsFor(feature);
  if (flags.json) {
    json({ ...feature, commands });
    return 0;
  }
  out(`${feature.id}: ${feature.name} (${feature.state})`);
  out(feature.summary);
  if (feature.reason) out(`why: ${feature.reason}`);
  if (feature.recordedIn) out(`recorded in: ${feature.recordedIn}`);
  if (feature.switch) out(`switch: ${feature.switch}`);
  out('');
  section('personas', feature.personas);
  section('may', feature.permissions?.may);
  section('refused', feature.permissions?.refused);
  section('states to check', feature.states);
  const c = feature.code ?? {};
  section('web', c.web);
  section('server', c.server);
  section(
    'api',
    (c.api ?? []).map((e) => {
      const [group, name] = e.split('.');
      return `${e}  ${groups.get(group)?.endpoints.get(name) ?? '(missing)'}`;
    }),
  );
  section('domain', c.domain);
  section('other code', c.other);
  section('tables', c.tables);
  section('agent skills', feature.skills);
  section('qa playbook', feature.qa ? [feature.qa] : []);
  section('tests', testFiles(feature));
  const browser = describeBrowser(feature);
  section('browser check', browser ? [browser] : []);
  section(
    'verify',
    commands.map((x) => x.command),
  );
  section('gaps', feature.gaps);
  return 0;
};

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

const changedFiles = (base) => {
  const mergeBase = git('merge-base', base, 'HEAD')[0];
  return [
    ...new Set([
      ...git('diff', '--name-only', mergeBase),
      ...git('ls-files', '--others', '--exclude-standard'),
    ]),
  ].toSorted();
};

/** A claimed path owns a file when it is the file or a directory above it. */
const owns = (claimed, file) =>
  file === claimed || file.startsWith(`${claimed.replace(/\/$/, '')}/`);

export const whichCommand = (paths, flags) => {
  let files = paths;
  if (flags.changed) {
    try {
      files = changedFiles(flags.base ?? 'main');
    } catch (error) {
      process.stderr.write(
        `cannot list changed files against ${flags.base ?? 'main'}: ${error.message}\n`,
      );
      return 2;
    }
  }
  if (files.length === 0) {
    process.stderr.write(
      'usage: pnpm verify which <path...>  or  pnpm verify which --changed [--base main]\n',
    );
    return 2;
  }
  const map = loadMap();
  const groups = apiGroups();
  const byFile = files.map((file) => ({
    file,
    features: map.features
      .filter((f) => claimedPaths(f, groups).some((p) => owns(p, file)))
      .map((f) => f.id),
  }));
  const ids = [...new Set(byFile.flatMap((x) => x.features))];
  const unmapped = byFile.filter((x) => x.features.length === 0).map((x) => x.file);
  const commands = ids.flatMap((id) => commandsFor(findFeature(map, id)).map((c) => c.command));
  if (flags.json) {
    json({ files: byFile, features: ids, unmapped, commands });
    return 0;
  }
  for (const { file, features } of byFile)
    out(`${file}  ${features.length ? features.join(', ') : '(no feature)'}`);
  out('');
  if (ids.length > 0) {
    out(`features: ${ids.join(', ')}`);
    out(`run: pnpm verify run ${ids.join(' ')} --kind tests`);
    out('then, with the QA environment running, --kind api and --kind browser for the same ids.');
  }
  if (unmapped.length > 0)
    out(
      `${unmapped.length} file(s) belong to no feature; if one adds or changes behavior, map it (.claude/skills/feature-map/SKILL.md).`,
    );
  return 0;
};
