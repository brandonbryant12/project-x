// The task-owned QA environment (`pnpm verify env <build|seed|start|stop|status>`).
//
// One server process that serves the API and the built web app on QA_PORT
// (default 4410), with an in-process PGlite database under QA_DATA_DIR
// (default .data/qa, git-ignored), dev sign-in, the mock assistant and the log
// mail transport. It never touches Docker, a Postgres URL, the dev ports 4400
// and 5400, or any database other than its own directory.
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ROOT, pnpm } from './paths.mjs';

const RESERVED_PORTS = new Set([4400, 5400, 5442]);

/** Resolved settings for the QA environment, from QA_PORT and QA_DATA_DIR. */
export const qaSettings = (env = process.env) => {
  const port = Number(env.QA_PORT ?? 4410);
  const dataDir = resolve(ROOT, env.QA_DATA_DIR ?? '.data/qa');
  return {
    port,
    dataDir,
    dbDir: join(dataDir, 'db'),
    log: join(dataDir, 'server.log'),
    pidFile: join(dataDir, 'server.pid'),
    baseUrl: env.QA_BASE_URL ?? `http://localhost:${port}`,
    webDist: join(ROOT, 'apps/web/dist'),
  };
};

/** Refuses settings that could reach anything but the task's own data and port. */
const guard = (s) => {
  const problems = [];
  if (!Number.isInteger(s.port) || s.port < 1024 || s.port > 65535)
    problems.push(`QA_PORT must be a port number above 1023 (got ${s.port}).`);
  if (RESERVED_PORTS.has(s.port))
    problems.push(`QA_PORT ${s.port} is a shared development port; use another (default 4410).`);
  const inherited = process.env.DATABASE_URL;
  if (inherited && !inherited.startsWith('pglite:'))
    problems.push(
      'DATABASE_URL points at a server database; the QA environment only uses its own PGlite directory. Unset it.',
    );
  const inRepo =
    !relative(ROOT, s.dataDir).startsWith('..') && !isAbsolute(relative(ROOT, s.dataDir));
  if (inRepo) {
    const ignored = spawnSync('git', ['check-ignore', '-q', join(s.dataDir, 'db')], { cwd: ROOT });
    if (ignored.status !== 0)
      problems.push(`QA_DATA_DIR ${s.dataDir} is inside the repository but not git-ignored.`);
  }
  return problems;
};

/** The server's environment: always PGlite, dev auth, mock assistant, log mail. */
const serverEnv = (s) => {
  const databaseUrl = `pglite:${s.dbDir}`;
  if (!databaseUrl.startsWith('pglite:')) throw new Error('refusing a non-PGlite database');
  return {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(s.port),
    APP_ORIGIN: s.baseUrl,
    DATABASE_URL: databaseUrl,
    DB_MIGRATE_ON_START: 'true',
    AUTH_MODE: 'dev',
    DECISIONS_MODE: 'mock',
    TELEMETRY_ENABLED: 'false',
    LOG_FORMAT: 'pretty',
    SCHEDULER_ENABLED: 'true',
    NOTIFY_TRANSPORT: 'log',
    WEB_DIST_DIR: s.webDist,
  };
};

const readPid = (s) => {
  if (!existsSync(s.pidFile)) return null;
  const pid = Number(readFileSync(s.pidFile, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** True when something answers /readyz at the base URL. */
export const ready = async (baseUrl, timeoutMs = 1500) => {
  try {
    const response = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
};

const portAnswers = async (port) => {
  try {
    await fetch(`http://localhost:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
};

export const status = async (s = qaSettings()) => {
  const pid = readPid(s);
  const owned = pid !== null && alive(pid);
  return {
    url: s.baseUrl,
    port: s.port,
    dataDir: s.dataDir,
    log: s.log,
    pid: owned ? pid : null,
    running: owned,
    ready: await ready(s.baseUrl),
    seeded: existsSync(s.dbDir),
    webBuilt: existsSync(join(s.webDist, 'index.html')),
  };
};

/** Runs pnpm (the one running `pnpm verify` when there is one) in the foreground. */
const run = (args, options) => {
  const [bin, binArgs] = pnpm(args);
  const result = spawnSync(bin, binArgs, { stdio: 'inherit', cwd: ROOT, ...options });
  return result.status ?? 1;
};

const build = () => run(['--filter', '@repo/web', 'build']);

const seed = async (s) => {
  const current = await status(s);
  if (current.running || (await portAnswers(s.port)))
    return fail(`a server is running on :${s.port}; run \`pnpm verify env stop\` before seeding`);
  rmSync(s.dbDir, { recursive: true, force: true });
  mkdirSync(s.dataDir, { recursive: true });
  // seed.ts --reset deletes only the pglite directory it is given, then migrates and seeds.
  return run(['--filter', '@repo/server', 'exec', 'tsx', 'src/scripts/seed.ts', '--reset'], {
    env: serverEnv(s),
  });
};

const start = async (s) => {
  const current = await status(s);
  if (current.running) {
    process.stdout.write(`already running on ${s.baseUrl} (pid ${current.pid})\n`);
    return current.ready ? 0 : 1;
  }
  if (await portAnswers(s.port))
    return fail(`port ${s.port} is in use by another process; set QA_PORT to a free port`);
  if (!current.seeded) return fail('no QA database yet; run `pnpm verify env seed` first');
  if (!current.webBuilt)
    process.stdout.write(
      'note: apps/web/dist is missing; browser checks need `pnpm verify env build`\n',
    );
  mkdirSync(s.dataDir, { recursive: true });
  const out = openSync(s.log, 'a');
  const child = spawn(join(ROOT, 'apps/server/node_modules/.bin/tsx'), ['src/main.ts'], {
    cwd: join(ROOT, 'apps/server'),
    env: serverEnv(s),
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  closeSync(out);
  writeFileSync(s.pidFile, `${child.pid}\n`);
  for (let i = 0; i < 90; i++) {
    if (await ready(s.baseUrl)) {
      process.stdout.write(`ready on ${s.baseUrl} (pid ${child.pid}); log: ${s.log}\n`);
      return 0;
    }
    if (!alive(child.pid)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return fail(`server did not become ready; see ${s.log}`);
};

const stop = async (s) => {
  const pid = readPid(s);
  if (pid === null || !alive(pid)) {
    rmSync(s.pidFile, { force: true });
    process.stdout.write('not running\n');
    return 0;
  }
  // The server was started detached, so it leads its own process group.
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(-pid, signal);
    } catch {
      // already gone
    }
    for (let i = 0; i < 20 && alive(pid); i++) await new Promise((r) => setTimeout(r, 250));
    if (!alive(pid)) break;
  }
  rmSync(s.pidFile, { force: true });
  const free = !(await portAnswers(s.port));
  process.stdout.write(
    `stopped (pid ${pid}); port ${s.port} ${free ? 'is free' : 'STILL ANSWERS'}\n`,
  );
  return free ? 0 : 1;
};

const fail = (message) => {
  process.stderr.write(`verify env: ${message}\n`);
  return 1;
};

export const envCommand = async (action, { json }) => {
  const s = qaSettings();
  const problems = guard(s);
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`verify env: ${p}\n`);
    return 2;
  }
  switch (action) {
    case 'build':
      return build();
    case 'seed':
      return seed(s);
    case 'start':
      return start(s);
    case 'stop':
      return stop(s);
    case 'status': {
      const current = await status(s);
      if (json) process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
      else
        process.stdout.write(
          [
            `url       ${current.url}`,
            `server    ${current.running ? `running (pid ${current.pid})` : 'not running'}${current.ready ? ', ready' : ''}`,
            `database  ${current.seeded ? s.dbDir : 'not seeded'}`,
            `web build ${current.webBuilt ? 'present' : 'missing'}`,
            `log       ${current.log}`,
          ].join('\n') + '\n',
        );
      return current.ready ? 0 : 3;
    }
    default:
      return fail('usage: pnpm verify env <build|seed|start|stop|status> [--json]');
  }
};
