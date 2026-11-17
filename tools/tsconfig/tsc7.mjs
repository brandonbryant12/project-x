#!/usr/bin/env node
// Runs the native TypeScript 7 compiler. `typescript` in this workspace is TS 6
// (editor + Effect language service); both packages ship a `tsc` bin, so this
// wrapper makes the choice explicit. See docs/adr/0002.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve('typescript-7/package.json')), 'bin', 'tsc');
const result = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
