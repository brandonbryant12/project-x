import type { Plugin } from 'vite';
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from './src/lib/brand.ts';

/**
 * Installable web app (path to A, quick capture). The manifest and the page
 * title are generated from `src/lib/brand.ts` so the name is never hardcoded.
 * Colors are the light canvas and pine primary from the Quiet Ledger tokens.
 */
export const manifest = {
  name: PRODUCT_NAME,
  short_name: PRODUCT_SHORT_NAME,
  description: 'Observe real work, sign what you saw, and follow your development.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#faf9f6',
  theme_color: '#faf9f6',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  shortcuts: [
    {
      name: 'I saw this',
      short_name: 'I saw this',
      url: '/observations/new',
      icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    },
  ],
} as const;

const FILE = 'manifest.webmanifest';
const body = () => `${JSON.stringify(manifest, null, 2)}\n`;

export const webManifest = (): Plugin => ({
  name: 'web-manifest',
  configureServer(server) {
    server.middlewares.use(`/${FILE}`, (_req, res) => {
      res.setHeader('content-type', 'application/manifest+json');
      res.end(body());
    });
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: FILE, source: body() });
  },
  transformIndexHtml: (html) =>
    html
      .replaceAll('%PRODUCT_NAME%', PRODUCT_NAME)
      .replaceAll('%PRODUCT_SHORT_NAME%', PRODUCT_SHORT_NAME),
});
