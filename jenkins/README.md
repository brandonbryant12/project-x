# Jenkins CI/CD templates (for downstream forks)

Downstream repositories fork this codebase and run their own Jenkins instances
configured via **Pipeline from SCM** across **dev**, **preprod**, and **prod**.
Because we do not control each downstream Jenkins server, this directory
provides ready-to-adapt **YAML** and **Groovy Jenkinsfile** templates showing
our recommended quality gates, Helm validation, and Vault-backed deployment
boundaries.

## Files in this directory

| File                                                         | Purpose                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [`pipeline.yaml`](./pipeline.yaml)                           | Standard declarative Jenkins YAML pipeline template (CI + container build + Helm `dev` → `preprod` → `prod` rollout)       |
| [`jcasc-jobs.yaml`](./jcasc-jobs.yaml)                       | Optional Jenkins Configuration as Code (JCasC) / Job DSL YAML to register PR CI + Main CD jobs from SCM                    |
| [`Jenkinsfile.pr-ci.groovy`](./Jenkinsfile.pr-ci.groovy)     | Pull-request Pipeline-from-SCM script (blocking quality gates, formal proofs, build, Helm lint across all 3 envs)          |
| [`Jenkinsfile.main-cd.groovy`](./Jenkinsfile.main-cd.groovy) | Main-branch Pipeline-from-SCM script (same gates + Docker build/push + `dev` → `preprod` → `prod` `helm upgrade --atomic`) |

## Quality gate contract

Every PR and release commit runs the same canonical checks defined in
`package.json`:

1. `pnpm install --frozen-lockfile` (Node 24 from `.nvmrc`, pinned pnpm 12)
2. `pnpm check` — runs in order:
   - Node version check (`scripts/check-node.mjs`)
   - Formatting (`oxfmt --check`)
   - Strict lint (`oxlint --max-warnings=0`)
   - Typecheck across all workspace packages (`tsc7`)
   - Full test suite including `@alchemy.run/domain` `Domain.verify`, `Story.make` concurrent interleavings, exhaustive lifecycle & randomized `SkillLedger` proofs, PGlite DB integrity (`I1`–`I34`), and HTTP scenario tests
   - Dead-code / unused-export audit (`knip`)
   - Docs + zero-drift Mermaid diagram check (`pnpm docs:check`)
3. `pnpm build` — production server & web bundles
4. `helm lint helm/coaching-catalyst` + `helm template` dry-run against `values-dev.yaml`, `values-preprod.yaml`, and `values-prod.yaml`
5. **Optional Postgres 18 lane (`pnpm test:pg`):** Set `TEST_DATABASE_URL` in CI (e.g., an ephemeral Postgres 18 service container) to run the full integrity and scenario suites against real Postgres 18 (verifying `I14` advisory locks and `btree_gist` exclusion constraints).

## Downstream fork setup checklist

1. **Point Jenkins at SCM:** Create a Multibranch Pipeline pointing to
   `jenkins/Jenkinsfile.pr-ci.groovy` (or import `jenkins/pipeline.yaml` /
   `jenkins/jcasc-jobs.yaml` if your platform uses YAML-driven Jenkins pipelines).
2. **Never pass application secrets through Jenkins to Helm:** Application
   secrets (`DATABASE_URL`, `ENTRA_CLIENT_SECRET`, `AUTH_FLOW_SECRET`, optional
   `DECISIONS_API_KEY`, `SMTP_PASSWORD`, `OTEL_EXPORTER_OTLP_HEADERS`) belong in
   **HashiCorp Vault** (`coaching-catalyst/{dev,preprod,prod}`) and are mounted
   in-cluster via `ExternalSecret` or a pre-synced Kubernetes Secret. See
   [`../helm/README.md`](../helm/README.md).
3. **Jenkins-only credentials needed for CD:**
   - `container-registry-credentials`: push access to your firm's OCI registry (`IMAGE_REPOSITORY`).
   - `kubeconfig-dev`, `kubeconfig-preprod`, `kubeconfig-prod` (or per-env OIDC/IRSA roles on the Jenkins agent): permission to run `helm upgrade --install` in the target namespace only.
   - PR CI jobs should receive **zero** registry push or cluster credentials.
4. **Immutable image tags:** Always tag container builds with the commit SHA
   (e.g. `sha-<short-sha>`) and promote the exact same digest from `dev` →
   `preprod` → `prod` via `--set image.tag=...` so rollbacks are deterministic
   and auditable.
5. **Startup config validation:** The server validates every cross-field config
   invariant at boot via `resolveRuntimePlan` (`apps/server/src/platform/stack.ts`)
   and exits non-zero before serving traffic if a required Vault secret or
   cross-field constraint is missing — paired with `helm upgrade --atomic --wait`,
   bad config rolls back automatically.
