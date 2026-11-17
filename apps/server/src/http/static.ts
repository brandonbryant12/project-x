import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse, type HttpServerRequest } from 'effect/http';
import { existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

/**
 * Serves the built SPA in production (ADR 0011): hashed assets are immutable,
 * everything else falls back to index.html (no-store) for client routing.
 */
export const staticSpa = (distDir: string) =>
  HttpRouter.add('GET', '/*', (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const pathname = new URL(request.url, 'http://local').pathname;
      const candidate = normalize(join(distDir, pathname));
      const insideDist = candidate.startsWith(normalize(distDir));
      if (insideDist && pathname !== '/' && existsSync(candidate) && statSync(candidate).isFile()) {
        const response = yield* HttpServerResponse.file(candidate).pipe(Effect.orDie);
        return pathname.startsWith('/assets/')
          ? HttpServerResponse.setHeader(
              response,
              'cache-control',
              'public, max-age=31536000, immutable',
            )
          : response;
      }
      const index = yield* HttpServerResponse.file(join(distDir, 'index.html')).pipe(Effect.orDie);
      return HttpServerResponse.setHeader(index, 'cache-control', 'no-store');
    }),
  );

export const staticSpaLayer = (distDir: string | undefined) =>
  distDir && existsSync(join(distDir, 'index.html')) ? staticSpa(distDir) : Layer.empty;
