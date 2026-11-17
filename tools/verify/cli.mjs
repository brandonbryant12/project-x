#!/usr/bin/env node
// `pnpm verify`: the feature map's command line (docs/feature-map/README.md).
//
//   list [--state <s>] [--persona <name>]     features and their state
//   show <id>                                 everything about one feature
//   which <path...> | --changed [--base <ref>] features that own changed files
//   check                                     the map's staleness check
//   readme                                    regenerate docs/feature-map/README.md
//   run <id...> [--kind tests|api|browser] [--out <dir>] [--strict] [--workers 1]
//   env <build|seed|start|stop|status>        the task-owned QA environment
//
// Every command takes --json for agents. Plain Node, no dependencies, so the
// check runs in CI without an install.
import { checkCommand } from './lib/check.mjs';
import { envCommand } from './lib/env.mjs';
import { listCommand, showCommand, whichCommand } from './lib/query.mjs';
import { readmeCommand } from './lib/readme.mjs';
import { runCommand } from './lib/run.mjs';

const USAGE = `usage: pnpm verify <command> [options]

  list [--state built|behind_switch|api_only|deferred|not_built] [--persona "Maya Chen"]
  show <feature-id>
  which <path...>          or  which --changed [--base main]
  check                    staleness check (runs in pnpm check and CI)
  readme                   regenerate docs/feature-map/README.md from features.json
  run <feature-id...> [--kind tests|api|browser] [--out <dir>] [--strict] [--workers 1]
                           (Vitest and Playwright use at most 2 workers; --workers 1 for one)
  env <build|seed|start|stop|status>

  --json                   structured output for agents
`;

/** Splits argv into positionals and --flags (a flag takes the next word unless it is boolean). */
const BOOLEAN = new Set(['json', 'changed', 'strict', 'help']);
const parse = (argv) => {
  const positional = [];
  const flags = { kind: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split('=', 2);
    if (BOOLEAN.has(name)) flags[name] = true;
    else {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`--${name} needs a value`);
      if (name === 'kind') flags.kind.push(...value.split(','));
      else flags[name] = value;
    }
  }
  return { positional, flags };
};

const main = async () => {
  const argv = process.argv.slice(2);
  // `pnpm verify -- check` passes the separator through.
  if (argv[0] === '--') argv.shift();
  let parsed;
  try {
    parsed = parse(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  const { positional, flags } = parsed;
  const [command, ...rest] = positional;
  switch (command) {
    case 'list':
      return listCommand(flags);
    case 'show':
      return showCommand(rest, flags);
    case 'which':
      return whichCommand(rest, flags);
    case 'check':
      return checkCommand(flags);
    case 'readme':
      return readmeCommand(flags);
    case 'run':
      return runCommand(rest, flags);
    case 'env':
      return envCommand(rest[0], flags);
    default:
      process.stdout.write(USAGE);
      return command === undefined || flags.help ? 0 : 2;
  }
};

process.exitCode = await main();
