import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { randomUUID } from 'node:crypto';
import { Settings } from '../platform/settings.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

/**
 * Global edge policy (ADR 0014, controls CC6.6):
 *  - state-changing /api requests must carry `x-requested-with` and, when the
 *    browser sends an Origin, it must be the app's own origin (CSRF)
 *  - every response gets security headers and an `x-request-id`
 */
export const SecurityMiddleware = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const settings = yield* Settings;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestId = request.headers['x-request-id'] ?? randomUUID();
      const isApi = request.url.startsWith('/api/');
      if (isApi && !SAFE_METHODS.has(request.method)) {
        const origin = request.headers['origin'];
        const allowed = new URL(settings.appOrigin).origin;
        if (!request.headers['x-requested-with'] || (origin !== undefined && origin !== allowed)) {
          return yield* HttpServerResponse.json(
            { _tag: 'Forbidden', message: 'Cross-site request refused.' },
            { status: 403 },
          ).pipe(Effect.orDie);
        }
      }
      const response = yield* httpEffect.pipe(
        Effect.annotateLogs({ requestId }),
        Effect.annotateSpans({ 'request.id': requestId }),
      );
      return HttpServerResponse.setHeaders(response, {
        ...SECURITY_HEADERS,
        'x-request-id': requestId,
      });
    }),
  { global: true },
);
