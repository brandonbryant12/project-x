# Architecture overview

This is the one-page view of the system. Detail lives in
[the data model](data-model.md), [identity and access](identity-and-access.md),
[domain model graph](domain-model.md) (generated), [lifecycles](lifecycles.md)
(generated) and the [ADRs](../adr/README.md).

## 1. System context

```mermaid
flowchart LR
  subgraph Firm["Financial-services firm"]
    adv["Advisors / coachees"]
    coach["Professional coaches"]
    lead["Leaders"]
    gov["Tenant admins & compliance"]
    po["Program owners"]
  end
  app["Skills development app<br/>(this system)"]
  entra["Microsoft Entra ID<br/>SSO · app roles via AD groups · manager"]
  gemini["Google Gemini Decisions API<br/>closed-set judgments (advisory)"]
  dd["Datadog<br/>traces · metrics · logs"]
  mail["Firm SMTP relay<br/>email notifications"]

  adv & coach & lead & gov & po -->|browser| app
  app -->|OIDC sign-in, roles claim| entra
  app -->|text-only checks, no client identifiers| gemini
  app -->|OTLP| dd
  app -->|names, counts, dates, link — no content| mail
```

## 2. Containers

```mermaid
flowchart TB
  browser["Web app (React SPA)<br/>TanStack Router + Query · typed client from the API contract"]
  subgraph server["App server (Node 24, Effect 4) — one process (ADR 0011)"]
    edge["HTTP edge<br/>security headers · CSRF · request id · static SPA"]
    api["HttpApi handlers<br/>one use case or view per endpoint"]
    feat["Features<br/>catalog · development · observations · people · directory · support · hub · notifications · admin"]
    adv["Advisory runner<br/>runs after commit"]
    sched["Scheduler (advisory-locked)<br/>expiry sweeps · expiry reminders · weekly digest"]
    disp["Notification dispatcher"]
  end
  pg[("PostgreSQL 18<br/>schema · integrity triggers · exclusion constraints<br/>notification outbox")]
  smtp["SMTP relay<br/>(log transport in development)"]
  browser -->|same origin /api, session cookie| edge --> api --> feat --> pg
  feat -->|afterCommit| adv --> pg
  sched --> pg
  sched --> disp
  disp -->|claim pending rows, mark sent| pg
  disp --> smtp
```

**Packages and dependency direction.** The browser never imports server code:

```mermaid
flowchart LR
  web["apps/web"] --> apiPkg["packages/api<br/>HttpApi contract"]
  web --> ui["packages/ui<br/>design system"]
  apiPkg --> domain["packages/domain<br/>lifecycles · policy · scoring · privacy"]
  server["apps/server"] --> apiPkg
  server --> db["packages/db<br/>schema · migrations"]
  server --> ai["packages/ai<br/>Decisions service"]
  server --> domain
  db --> domain
```

## 3. Inside the server

```mermaid
flowchart TB
  subgraph handler["Handler (per endpoint)"]
    h["decode request → call use case → view → apiErrorsOnly"]
  end
  subgraph usecase["Use case — Effect.fn('useCase.x')"]
    a["CurrentActor (from session)"] --> p["policy: may this actor? (packages/domain/policy)"]
    p --> m["lifecycle: does the state allow it? (XState machine)"]
    m --> t["transactionally: write rows + audit_event (+ version check)"]
    t --> ac["afterCommit: assistant privacy screen"]
  end
  h --> usecase
```

`decide()` combines the policy check and the lifecycle check. A policy
refusal returns `Forbidden`. A lifecycle refusal returns `InvalidTransition`
with a human explanation. Anything the actor may not see returns `NotFound`.

## 4. Key flow: signing an observation

```mermaid
sequenceDiagram
  actor O as Observer (coach or leader)
  participant W as Web app
  participant S as Server
  participant DB as PostgreSQL
  participant AI as Decisions API
  O->>W: write level + "What I saw"
  W->>S: PUT /observations/:id/draft (version n)
  S->>DB: save draft (version n → n+1)
  S-->>W: view (autosaved)
  O->>W: Review and sign
  W->>S: POST /observations/:id/sign
  S->>S: eligibility as of the interaction date · lifecycle allows SIGN
  S->>DB: BEGIN
  S->>DB: lock this person's ledger (advisory xact lock)
  S->>DB: status = signed, content_digest
  S->>DB: credit_entry per credited skill (FKs pin it to the observation)
  S->>DB: badge_award + receipt rows when criteria are met
  S->>DB: audit_event
  S->>DB: COMMIT
  S-->>W: receipt (credits, badges earned)
```

## 5. Assistant checks

```mermaid
flowchart LR
  text["Text<br/>a coachee's reflection"] --> local{"Local screen<br/>(deterministic, fails closed)"}
  local -- PII pattern --> held["Evidence: held"]
  local -- clear --> check["Assistant check<br/>privacy-screen vN"]
  check --> effect{"Effect"}
  effect -- hold --> held
  effect -- escalate --> esc["Evidence: escalated → compliance"]
  effect -- none or failed --> avail["Evidence: stays available"]
  held -- admin releases --> disp[("advisory_disposition")]
  esc -- compliance resolves --> disp
```

## 5a. Notifications: the outbox

Built ([ADR 0018](../adr/0018-notifications-outbox-and-content-policy.md)).
Email is the only channel. `NOTIFY_TRANSPORT` picks `smtp` or `log` (the
default in development).

```mermaid
sequenceDiagram
  actor A as Advisor
  participant S as Server (use case)
  participant DB as PostgreSQL
  participant D as Dispatcher (scheduler fiber)
  participant M as SMTP relay (or log)
  actor O as Observer
  A->>S: ask Leo to observe
  S->>DB: BEGIN
  S->>DB: observation (requested) · audit_event
  S->>DB: notification (observation_requested, dedupe_key) — no free text
  S->>DB: COMMIT
  loop every minute; each row claimed with FOR UPDATE SKIP LOCKED
    D->>DB: pending rows past send_after
    D->>DB: recipient's preference (email on or off)
    D->>M: template(first name, display name, verb, date, link)
    D->>DB: status = sent (or skipped / failed, attempts + 1)
  end
  M-->>O: "Maya asked you to observe … open until Mon 30 Nov" + link
```

- A row exists if and only if the transition committed. Delivery is at least
  once.
- The weekly digest and the 48-hour expiry reminder are written by the
  scheduler, with dedupe keys, so a second replica or a rerun writes nothing
  new. The digest's numbers are computed when it is sent.

## 6. Data model (core)

```mermaid
erDiagram
  TENANT ||--o{ PERSON : has
  PERSON ||--o{ REPORTING_LINE : "manages / reports (dated)"
  PERSON ||--o{ ROLE_GRANT : "holds (dated)"
  PERSON ||--o{ ENGAGEMENT : "coach / coachee"
  SKILL ||--|{ SKILL_VERSION : publishes
  SKILL_VERSION ||--|{ SKILL_LEVEL : has
  SKILL_LEVEL ||--o{ SKILL_INDICATOR : has
  PERSON ||--o{ PLAN : owns
  PLAN ||--|{ PLAN_SKILL : "focus (target level)"
  PLAN ||--o{ ACTIVITY : contains
  ACTIVITY ||--o{ INTERACTION : "done as"
  INTERACTION ||--o{ EVIDENCE : "reflected in"
  INTERACTION ||--o{ OBSERVATION : "observed in"
  OBSERVATION ||--|{ OBSERVATION_RATING : "rates (pinned version)"
  OBSERVATION_RATING ||--o{ CREDIT_ENTRY : "creates on SIGN"
  CREDIT_ENTRY ||--o| CREDIT_REVERSAL : "cancelled by"
  BADGE_AWARD ||--|{ BADGE_AWARD_CREDIT : "receipt"
  CREDIT_ENTRY ||--o{ BADGE_AWARD_CREDIT : "counts toward"
  OBSERVATION }o--|| REPORTING_LINE : "basis (leader)"
  OBSERVATION }o--|| ENGAGEMENT : "basis (coach)"
  OBSERVATION }o--|| OBSERVER_DESIGNATION : "basis (designated)"
  PERSON ||--o{ NOTIFICATION : "recipient"
  ADVISORY_CHECK ||--o{ ADVISORY_DISPOSITION : "human decision"
```

The three kinds of tables follow different rules:

- **Directory mirrors** (dated): person, reporting line, role grant.
- **Workflow entities** (status plus version): plan, activity, observation,
  engagement, evidence.
- **Append-only facts** (enforced by triggers): credit, reversal, audit,
  `domain_event` journal, published catalog. A designation is a fact that may
  be ended once.
- **Operational** (deleted after 90 days): sessions, the notification outbox,
  preferences.

See the [data model](data-model.md).

## 7. Deployment

```mermaid
flowchart LR
  user["Browser"] --> ingress["Ingress / load balancer<br/>TLS"]
  ingress --> app1["app container (replica)"] & app2["app container (replica)"]
  app1 & app2 --> pg[("Managed PostgreSQL 18<br/>btree_gist")]
  app1 & app2 -->|OTLP :4318| agent["Datadog Agent<br/>(sidecar or DaemonSet)"]
  app1 & app2 --> entra["Entra ID"] & gem["Gemini Decisions"]
```

- **One image**, built from `apps/server/Dockerfile`, serves the API and the
  SPA. It runs read-only, as a non-root user, under tini, with a readiness
  check.
- Replicas are stateless. Sessions live in Postgres. The scheduler takes a
  transaction-scoped advisory lock, so only one replica sweeps at a time. The
  notification dispatcher claims rows with `FOR UPDATE SKIP LOCKED` instead.
- Operations: [incident response](../runbooks/incident-response.md),
  [deprovisioning](../runbooks/deprovisioning.md),
  [backup and restore](../runbooks/backup-and-restore.md).
- Migrations run at startup (`DB_MIGRATE_ON_START`) or as a separate release
  step.

## 8. Cross-cutting choices

| Concern              | Choice                                                                                      | ADR              |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------- |
| Language and runtime | TypeScript, Effect 4 (HttpApi, Schema, layers), Node 24                                     | 0002, 0003       |
| State                | XState machines, enforced server-side with pure transitions                                 | 0005             |
| Data                 | Postgres 18 + Drizzle's Effect driver; PGlite runs the same migrations in tests             | 0004             |
| Identity             | Entra OIDC; app roles mirrored to dated grants; relationships carry authority               | 0006, 0014       |
| Credit               | Only from SIGN; append-only demonstrations; badges by criteria                              | 0007             |
| AI                   | Advisory only; privacy screen only; explainable records; learning loop deferred             | 0008, 0015, 0016 |
| Privacy and audit    | No client PII; purgeable notes; append-only audit with `seq`                                | 0012, 0015       |
| Observability        | Effect native OTLP to Datadog                                                               | 0013             |
| Notifications        | Transactional outbox, dispatcher in the scheduler, no content in messages                   | 0018             |
| Coaching rhythm      | Deferred until pilot feedback: meetings stay in Outlook, next steps stay on the observation | 0019             |
| Observer supply      | Designated observers, bounded and anti-collusion                                            | 0020             |
| Adoption             | Program owner sees aggregates only, cells under five hidden                                 | 0021             |
| Domain & proofs      | `@alchemy.run/domain` fact model, 3-layer formal verification, zero-drift Mermaid diagrams  | 0023             |
| Catalog & voice      | Admin catalog authoring studio, core/common tiers, level-up playbooks, on-device voice note | 0024             |
