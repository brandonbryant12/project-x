// Fails fast, with a clear message, when the running Node is older than the
// version this repository is built for (.nvmrc; package.json "engines").
// Older Node versions fail later in confusing ways (oxlint crashed on Node 22).
import { readFileSync } from 'node:fs';

const wanted = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
const [wantMajor] = wanted.split('.').map(Number);
const [major] = process.versions.node.split('.').map(Number);

if (major < wantMajor) {
  process.stderr.write(
    `\nThis repository needs Node ${wantMajor} (.nvmrc says ${wanted}); you are running ${process.version}.\n` +
      `Run \`nvm use\` (or install Node ${wantMajor}) and try again.\n`,
  );
  process.exit(1);
}
