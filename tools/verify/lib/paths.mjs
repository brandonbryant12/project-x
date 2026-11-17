import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root (tools/verify/lib -> ../../..). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * How to call pnpm from a child process: the same pnpm that runs `pnpm verify`
 * (npm_execpath) when there is one, else `pnpm` on the PATH.
 */
export const pnpm = (args) => {
  const execPath = process.env.npm_execpath;
  return execPath && /pnpm/.test(execPath) && /\.c?js$/.test(execPath)
    ? [process.execPath, [execPath, ...args]]
    : ['pnpm', args];
};
