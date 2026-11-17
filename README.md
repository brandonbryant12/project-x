# Coaching Catalyst

A development program for a financial-services firm. Skills that matter to
the business are named in a shared catalog. People develop them through real
work, such as client meetings, book reviews and team conversations. Credit
comes **only** when a coach or leader who saw the work signs an observation.
There is no self-report, no points, and the AI never grants credit.

- **Product:** [vision](docs/product/vision.md) · [domain model](docs/product/domain-model.md) · [UX brief](docs/product/ux-brief.md) · [open questions](docs/product/open-questions.md) · [questions for domain experts](docs/product/domain-expert-questions.md)
- **Engineering:** [agent guide](AGENTS.md) · [ADRs](docs/adr/README.md) · [data model](docs/architecture/data-model.md) · [identity & access](docs/architecture/identity-and-access.md) · [testing](docs/testing/strategy.md) · [decision framework](docs/engineering/decision-making.md)
- **Governance:** [controls matrix (SOC 2, FINRA/SEC, AI)](docs/compliance/controls.md) · [AI system card](docs/compliance/ai-system-card.md)
- **Operations:** [incident response](docs/runbooks/incident-response.md) · [deprovisioning](docs/runbooks/deprovisioning.md) · [backup and restore](docs/runbooks/backup-and-restore.md)

## Run it locally

Requirements: Node 24 (see `.nvmrc`), pnpm 12 (`npm i -g pnpm@12`), and Docker.

```bash
pnpm install
pnpm db:up                                  # Postgres 18 on :5442
cp apps/server/.env.example apps/server/.env
pnpm db:reset                               # migrate and seed the fictional Northwind tenant
pnpm dev                                    # API on :4400, web app on http://localhost:5400
```

Sign in as any seeded persona from the sign-in page:

| Persona | Role in the seed                                       |
| ------- | ------------------------------------------------------ |
| Maya    | Advisor who has earned badges                          |
| Leo     | Leader with an observation waiting                     |
| Sam     | Coach with a plan to agree                             |
| Aisha   | Returned observation and a reflection held for privacy |
| Rhea    | Admin: audit trail and AI usage                        |
| Nina    | Compliance reviewer                                    |

## Stack

| Layer         | Tools                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| Backend       | TypeScript on Effect 4 (HttpApi, Schema, layers, native OTLP)                       |
| Data          | PostgreSQL 18 via Drizzle's Effect driver, tested in-process on PGlite              |
| Domain rules  | XState v5 lifecycle machines                                                        |
| Web app       | React 19 + TanStack Router/Query, with a typed client derived from the API contract |
| UI            | Tailwind v4 + Radix                                                                 |
| Identity      | Microsoft Entra ID (app roles assigned to AD groups)                                |
| AI            | Gemini Decisions API (advisory only)                                                |
| Observability | OpenTelemetry to Datadog                                                            |
| AI tracing    | LangSmith, optional                                                                 |

Monorepo: `packages/{domain,api,db,ai,ui}` and `apps/{server,web}`.

## Common commands

| Command                                    | Purpose                                          |
| ------------------------------------------ | ------------------------------------------------ |
| `pnpm check`                               | Format, lint, typecheck, tests, knip             |
| `pnpm db:reset`                            | Wipe, migrate and seed the local database        |
| `pnpm --filter @repo/web screenshots`      | Visual review, with the API and web app running  |
| `docker compose --profile otel up -d`      | View traces and logs locally (Aspire on :18888)  |
| `docker build -f apps/server/Dockerfile .` | Production image: the API and SPA in one process |
