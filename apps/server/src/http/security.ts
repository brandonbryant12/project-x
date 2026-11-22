import { Clock, Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { randomUUID } from 'node:crypto';
import { recordHttpRequest, routeGroupOf } from '../platform/metrics.ts';
import { Settings } from '../platform/settings.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(self), geolocation=()',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

/**
 * Global edge policy (ADR 0013, ADR 0014, controls CC6.6):
 *  - state-changing /api requests must carry `x-requested-with` and, when the
 *    browser sends an Origin, it must be the app's own origin (CSRF)
 *  - every response gets security headers and an `x-request-id`
 *  - records low-cardinality HTTP metrics and structured completion logs with
 *    trace/Datadog correlation (no query strings or request bodies)
 */
export const SecurityMiddleware = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const settings = yield* Settings;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestId = request.headers['x-request-id'] ?? randomUUID();
      const startedAt = yield* Clock.currentTimeMillis;
      const isApi = request.url.startsWith('/api/');
      const routeGroup = routeGroupOf(request.url);

      if (isApi && !SAFE_METHODS.has(request.method)) {
        const origin = request.headers['origin'];
        const allowed = new URL(settings.appOrigin).origin;
        if (!request.headers['x-requested-with'] || (origin !== undefined && origin !== allowed)) {
          const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
          yield* recordHttpRequest(request.method, request.url, 403, durationMs);
          yield* Effect.logWarning('http.request.refused', {
            requestId,
            'http.method': request.method,
            'http.route_group': routeGroup,
            'http.status_code': 403,
            duration_ms: durationMs,
          });
          return yield* HttpServerResponse.json(
            { _tag: 'Forbidden', message: 'Cross-site request refused.' },
            { status: 403 },
          ).pipe(Effect.orDie);
        }
      }

      const response = yield* httpEffect.pipe(
        Effect.annotateLogs({ requestId }),
        Effect.annotateSpans({
          'request.id': requestId,
          'http.route_group': routeGroup,
        }),
      );

      const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
      yield* recordHttpRequest(request.method, request.url, response.status, durationMs);
      if (isApi) {
        const logAnnotations = {
          requestId,
          'http.method': request.method,
          'http.route_group': routeGroup,
          'http.status_code': response.status,
          duration_ms: durationMs,
        };
        if (response.status >= 500) {
          yield* Effect.logError('http.request', logAnnotations);
        } else if (response.status >= 400) {
          yield* Effect.logWarning('http.request', logAnnotations);
        } else {
          yield* Effect.logDebug('http.request', logAnnotations);
        }
      }

      return HttpServerResponse.setHeaders(response, {
        ...SECURITY_HEADERS,
        'x-request-id': requestId,
      });
    }),
  { global: true },
);
