# ADR 0011: One server process serves the API and the SPA; scheduled sweeps run in-process

- Status: Accepted
- Date: 2026-11-16

## Context

Content Studio runs separate web, server, worker and sandbox containers
because media generation is long-running, paid and CPU-heavy. Coaching
Catalyst's background needs are small:

- expiry sweeps (requests, proposals, plans);
- advisory checks, which are seconds-long HTTP calls;
- reminder digests, later.

## Decision

**One `apps/server` process serves `/api/*` and, in production, the built SPA
(static assets plus an `index.html` fallback with security headers). Periodic
work runs in-process as Effect fibers on a `Schedule`. The fibers are guarded
by a Postgres advisory lock, so that when several replicas run, only one runs
each sweep.**

- Sweeps are idempotent. Each one selects the rows past their deadline and
  sends `EXPIRE` through the lifecycle machine.
- Advisory checks run as forked fibers after the user's transaction commits.
  Each writes its own `advisory_check` row. The UI polls until the row
  completes.
- The web and API share an origin: Vite proxies `/api` in development, and
  the server serves the SPA in production. Same-origin cookies remove the
  need for CORS and for bearer tokens in the browser.

## Alternatives considered

- **A separate worker with a durable queue** (Effect Cluster or Workflow, as
  in Content Studio). It is warranted when jobs are long, paid or must survive
  restarts mid-flight. None of ours are yet.
- **A separate static web container.** It is another image to build and
  another place to configure CSP. An ingress or CDN can still sit in front
  later.

## Consequences

- Docker Compose runs `app`, `postgres` and optional observability services.
- If background work grows (bulk sync, digests, recordings), introduce
  `apps/worker` with a durable queue and record a superseding ADR.
