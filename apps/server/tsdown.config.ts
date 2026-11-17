import { defineConfig } from 'tsdown';

/** Bundles the server and its workspace packages into dist/main.mjs. */
export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  noExternal: [/^@repo\//],
  sourcemap: true,
  clean: true,
});
