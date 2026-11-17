import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { webManifest } from './web-manifest.config.ts';

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.test\\.',
    }),
    react(),
    tailwindcss(),
    webManifest(),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5400,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:4400', changeOrigin: false } },
  },
  preview: { port: 5400 },
  build: { outDir: 'dist', sourcemap: true },
});
