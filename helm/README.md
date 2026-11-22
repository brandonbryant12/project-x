# Helm deployment & Vault secrets guide

This directory contains the production Helm v3 chart for **Coaching Catalyst**
([`coaching-catalyst/`](./coaching-catalyst/)), built for its single-deployable
container architecture ([ADR 0011](../docs/adr/0011-single-deployable-with-in-process-scheduler.md)):
one stateless image (`apps/server/Dockerfile`) serves `/api`, the built React
SPA, health probes (`/healthz`, `/readyz`), the advisory-locked scheduler, and
the `FOR UPDATE SKIP LOCKED` notification dispatcher.

## Quick validation

```bash
# Lint the chart against defaults, staging, and prod overlays
helm lint helm/coaching-catalyst
helm lint helm/coaching-catalyst -f helm/coaching-catalyst/values-staging.yaml
helm lint helm/coaching-catalyst -f helm/coaching-catalyst/values-prod.yaml

# Render Kubernetes manifests locally without a cluster
helm template coaching-catalyst helm/coaching-catalyst \
  -f helm/coaching-catalyst/values-prod.yaml \
  --set image.tag=sha-example
```

## Deploying a release

```bash
helm upgrade --install coaching-catalyst helm/coaching-catalyst \
  --namespace coaching-catalyst \
  --create-namespace \
  -f helm/coaching-catalyst/values-prod.yaml \
  --set image.repository=ghcr.io/your-org/coaching-catalyst \
  --set image.tag="<immutable-git-sha>" \
  --atomic \
  --wait \
  --timeout 5m
```

---

## Vault secrets matrix (which variables belong in Vault)

Every environment variable is decoded and validated in
`apps/server/src/platform/config.ts` and compiled into a typed runtime plan in
`apps/server/src/platform/stack.ts`. **Never store secret values in `values*.yaml`
or Jenkins job logs.**

### 1. Must live in Vault (required in production)

| Env var               | Why it belongs in Vault                                                                  | Format / notes                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Contains PostgreSQL credentials (`postgres://user:pass@host:5432/db?sslmode=require`)    | Prefer dynamic DB credentials via Vault's PostgreSQL secrets engine when available |
| `ENTRA_CLIENT_SECRET` | Microsoft Entra ID OIDC client credential (`AUTH_MODE=entra` is mandatory in production) | Rotate on firm IAM cadence; zero-downtime via Entra dual-secret overlap            |
| `AUTH_FLOW_SECRET`    | HMAC signing key for short-lived OIDC sign-in flow cookies (state, nonce, PKCE verifier) | At least 32 random bytes (`openssl rand -hex 32`); shared across all replicas      |

### 2. Must live in Vault when the corresponding feature is enabled

| Env var                      | Required when                                                                              | Notes                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `DECISIONS_API_KEY`          | `DECISIONS_MODE=live`                                                                      | Paid-tier Gemini Decisions API key (ADR 0008); also requires `DECISIONS_PAID_TIER_CONFIRMED=true` in ConfigMap |
| `SMTP_PASSWORD`              | `NOTIFY_TRANSPORT=smtp` with authenticated SMTP relay                                      | Omit if your internal firm SMTP relay uses IP/mTLS allowlisting without auth                                   |
| `OTEL_EXPORTER_OTLP_HEADERS` | Exporting OTLP directly to a SaaS intake requiring API-key headers (e.g. `dd-api-key=...`) | Not needed when sending OTLP to an in-cluster Datadog Agent DaemonSet on `status.hostIP:4318`                  |

### 3. Safe for ConfigMap (`values*.yaml` — non-secret configuration)

| Values path                                                                | Env var                                  | Production default                                                          |
| -------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `config.nodeEnv`                                                           | `NODE_ENV`                               | `production`                                                                |
| `config.port`                                                              | `PORT`                                   | `4400`                                                                      |
| `config.appOrigin`                                                         | `APP_ORIGIN`                             | `https://coaching.firm.example` (CSRF origin allowlist + OIDC callback)     |
| `config.dbMigrateOnStart`                                                  | `DB_MIGRATE_ON_START`                    | `true` (run migrations on startup; see Migration note below)                |
| `config.authMode`                                                          | `AUTH_MODE`                              | `entra` (`dev` is refused when `NODE_ENV=production`)                       |
| `config.entra.tenantId`                                                    | `ENTRA_TENANT_ID`                        | Entra directory GUID (not a secret)                                         |
| `config.entra.clientId`                                                    | `ENTRA_CLIENT_ID`                        | Entra app registration GUID (not a secret)                                  |
| `config.decisions.mode`                                                    | `DECISIONS_MODE`                         | `disabled` \| `mock` \| `live`                                              |
| `config.decisions.paidTierConfirmed`                                       | `DECISIONS_PAID_TIER_CONFIRMED`          | `true` only when `DECISIONS_MODE=live` uses a paid-tier key                 |
| `config.telemetry.enabled`                                                 | `TELEMETRY_ENABLED`                      | `true` when Datadog/OTLP is enabled                                         |
| `config.telemetry.otlpEndpoint`                                            | `OTEL_EXPORTER_OTLP_ENDPOINT`            | Auto-derived from `status.hostIP:4318` when `datadog.useNodeAgentOtlp=true` |
| `config.telemetry.otlpTracesEndpoint`                                      | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`     | Optional per-signal override                                                |
| `config.telemetry.otlpMetricsEndpoint`                                     | `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`    | Optional per-signal override                                                |
| `config.telemetry.otlpLogsEndpoint`                                        | `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`       | Optional per-signal override                                                |
| `config.telemetry.otlpProtocol`                                            | `OTEL_EXPORTER_OTLP_PROTOCOL`            | `protobuf` (preferred by Datadog) or `json`                                 |
| `config.telemetry.metricsTemporality`                                      | `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY` | `delta` (preferred by Datadog) or `cumulative`                              |
| `config.telemetry.serviceName`                                             | `OTEL_SERVICE_NAME`                      | `coaching-catalyst`                                                         |
| `config.telemetry.serviceVersion`                                          | `OTEL_SERVICE_VERSION`                   | Defaults to `image.tag`                                                     |
| `config.telemetry.environment`                                             | `OTEL_ENV`                               | `staging` \| `production`                                                   |
| `config.logLevel`                                                          | `LOG_LEVEL`                              | `info`                                                                      |
| `config.logFormat`                                                         | `LOG_FORMAT`                             | `json` (includes `dd.trace_id` / `dd.span_id` correlation + PII redaction)  |
| `config.schedulerEnabled`                                                  | `SCHEDULER_ENABLED`                      | `true` (advisory-locked across replicas)                                    |
| `config.notify.transport`                                                  | `NOTIFY_TRANSPORT`                       | `log` \| `smtp`                                                             |
| `config.notify.smtpHost` / `smtpPort` / `smtpSecure` / `smtpUser` / `from` | `SMTP_*` / `NOTIFY_FROM`                 | Relay coordinates                                                           |
| `config.features.designatedObservers`                                      | `FEATURE_DESIGNATED_OBSERVERS`           | `false` until enabled for a tenant                                          |

---

## Three ways to wire Vault into the chart

1. **External Secrets Operator (recommended):** Set `secrets.externalSecret.enabled: true`,
   point `secrets.externalSecret.secretStoreRef` at your Vault `ClusterSecretStore`,
   and set `secrets.externalSecret.vaultPath` (e.g. `coaching-catalyst/prod`).
   The chart renders `templates/externalsecret.yaml` and mounts the synced K8s
   Secret automatically.
2. **Pre-provisioned Kubernetes Secret (Vault CSI / SealedSecrets / platform sync):**
   Keep `secrets.externalSecret.enabled: false` and set `secrets.existingSecret`
   to the Secret synced into the namespace by your cluster platform.
3. **HashiCorp Vault Agent Injector:** Leave `secrets.existingSecret: ""` and
   supply `podAnnotations` for `vault.hashicorp.com/agent-inject` to render
   secrets into `/vault/secrets/` if your cluster standardizes on sidecar injection.

## Datadog & OTLP setup

When `datadog.enabled: true` (as in `values-staging.yaml` and `values-prod.yaml`):

- Pod & Deployment labels emit Datadog Unified Service Tags (`tags.datadoghq.com/{env,service,version}`).
- With `datadog.useNodeAgentOtlp: true`, the Deployment injects `DATADOG_HOST_IP`
  from `status.hostIP` and sets `OTEL_EXPORTER_OTLP_ENDPOINT=http://$(DATADOG_HOST_IP):4318`.
- Effect's native OTLP exporters send traces, `delta`-temporality metrics, and
  PII-redacted logs over OTLP/HTTP protobuf directly to the node-local Datadog
  Agent, while stdout JSON logs also include `dd.trace_id` and `dd.span_id`.

## Security hardening baked in

- `readOnlyRootFilesystem: true` with a 64 MiB `emptyDir` mounted at `/tmp`.
- `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`.
- `RollingUpdate` with `maxUnavailable: 0` + `PodDisruptionBudget` + multi-zone topology spread.
- `checksum/config` annotation forces an orderly rolling restart whenever `ConfigMap` values change.
