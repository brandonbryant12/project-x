# Identity, authentication and authorization

This document explains how a person signs in, where their capabilities come
from (Microsoft Entra ID / AD groups), and how the app decides what they may
see and do. It is the reference for engineers, for the Entra administrator
setting up a tenant, and for security and compliance reviewers.

Decisions: [ADR 0006](../adr/0006-identity-entra-roles-and-relationships.md),
[ADR 0009](../adr/0009-row-level-tenancy.md),
[ADR 0014](../adr/0014-session-auth-with-openid-client.md).

## 1. The model in one picture

```
            Entra ID (the firm's directory)
   ┌──────────────────────────────────────────────┐
   │ users ── member of ──► AD groups               │
   │ AD groups ── assigned ──► app roles            │   capabilities
   │   (Coach, TenantAdmin,                         │──────────────► role_grant
   │    ComplianceReviewer, ProgramOwner)           │   (dated)
   │ user.manager ─────────────────────────────────│──────────────► reporting_line
   └──────────────────────────────────────────────┘   relationships  (dated)

   In the app:   coaching engagements (coach ↔ coachee, accepted in-app)
                 ───────────────────────────────────────────────► engagement (dated)
```

There are two different kinds of authority, and we keep them separate:

| Kind                                            | Examples                                                | Source                                                                      | Stored as                                    |
| ----------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| **Capabilities** (what you are _allowed to be_) | Coach, Tenant admin, Compliance reviewer, Program owner | Entra **app roles**, assigned to AD groups                                  | `role_grant` rows (`valid_from`, `valid_to`) |
| **Relationships** (who you are _to someone_)    | Leader of, coach of, coachee of                         | Reporting lines from the directory; coaching engagements created in the app | `reporting_line`, `engagement`               |

"Leader", "team" and "coachee" are **never stored as roles**. A person is a
leader _because_ someone reports to them on a given date. The same person can
be a leader, a coachee of their own coach, and a coach to others, all at once
("the same roles at every altitude").

## 2. Authentication

### Production: Entra ID OpenID Connect

1. The browser opens `GET /api/auth/entra/start`. The server creates a state,
   a nonce and a PKCE verifier and stores them in a short-lived (10 minute),
   HMAC-signed, HttpOnly cookie scoped to `/api/auth/entra`. It then redirects
   to Microsoft.
2. Microsoft authenticates the user, applying the firm's MFA and conditional
   access, and redirects to `GET /api/auth/entra/callback`.
3. The server uses `openid-client` (OpenID-certified) to exchange the code. It
   validates the issuer, audience, nonce, state and the PKCE verifier.
4. From the ID token claims:
   - `tid` selects the **tenant** (`tenant.entra_tenant_id`). An unknown
     tenant is refused.
   - `oid` is the stable person key. On a first sign-in we also match by email
     for people imported from HR before they signed in. If the person does not
     exist yet, they are created.
   - `roles` are mirrored to `role_grant` (see section 3).
5. A session is created and the user is redirected to the app. Everything above
   runs in one transaction with an audit event (`SIGN_IN`, method `entra`).

### Development: persona sign-in

`AUTH_MODE=dev` adds `GET /api/auth/dev/personas` and
`POST /api/auth/dev/sign-in`. Together they let anyone sign in as any seeded
person, which is how developers, agents and screenshot tests exercise each
role. **This mode refuses to start under `NODE_ENV=production`** (enforced in
`validateConfig`).

### Sessions

- The cookie `session` holds 32 random bytes (base64url). The database stores
  only the SHA-256 hash.
- The cookie is HttpOnly, SameSite=Lax, and Secure in production.
- A session ends after **12 hours idle** or **7 days** absolute. Sign-out
  deletes the row.
- Every request reloads the person and their **current** grants. A departed
  person, or a grant removed since sign-in, takes effect on the next request,
  not the next login.

### CSRF and the request edge

- The web app and API share one origin, so no CORS is needed.
- State-changing `/api` requests must send `x-requested-with`. When the
  browser sends an `Origin` header, it must match `APP_ORIGIN`. Requests that
  fail either check get a 403 before any handler runs.
- Every response carries security headers (CSP, `frame-ancestors 'none'`,
  `nosniff`, `Referrer-Policy`) and an `x-request-id`.

## 3. AD groups and app roles

### What the Entra administrator sets up (once per tenant)

1. Register an application (web, redirect URI
   `https://<app>/api/auth/entra/callback`) and create a client secret.
2. Define **app roles** on the application:

| App role value       | Grants in the app                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Coach`              | May form coaching engagements and observe coachees                                                                                                                        |
| `TenantAdmin` | Releases privacy holds; sees AI usage, the audit trail, and levels but not narratives; runs the directory import and departures; may also see the adoption view and administer the credit rules and catalog |
| `ComplianceReviewer` | Resolves escalated evidence; the only role that voids or upholds observations; may read narratives outside a relationship, and each read is audited; sees the audit trail |
| `ProgramOwner` | Sees the adoption view: aggregates only, no names (ADR 0021). Administers the credit rules, the skill catalog and the activity templates (ADR 0023). May set an individual value on one piece of planned work (API only). |

3. On the **enterprise application**, assign each app role to the AD
   **groups** that should hold it, for example `GRP-Coaching-Coaches` → `Coach`.
   Turn on "assignment required" so that only assigned users can sign in.
4. Give the app's operators the tenant ID, client ID and secret. They store
   them as `ENTRA_*` and generate `AUTH_FLOW_SECRET`.

Everyone who can sign in is a coachee by default. **No role is needed to
develop.**

### Why app roles and not raw group claims

- Group claims overflow the token at around 200 groups. Group display names
  can be renamed. Reading groups through Graph on every request needs stored
  refresh tokens. Content Studio spent about 900 lines on that path.
- The `roles` claim is small, stable, and controlled by the firm's directory
  team.
- **Fallback:** if the firm cannot use app roles, `tenant.settings.groupGrants`
  maps AD group **object IDs** (never names) to grants from the `groups`
  claim. If the token reports group overage while this fallback is in use,
  sign-in **fails closed** with an actionable message.

### Mirroring grants

On each Entra sign-in:

- grants in the token that have no open row get a row with
  `valid_from = today`;
- open `entra` grants that are no longer in the token are closed with
  `valid_to = today` (or deleted if granted the same day).

Grants are effective-dated, and an exclusion constraint forbids overlapping
intervals. That lets us answer "was Sam a coach on 3 March?" exactly, which
observer eligibility depends on.

> **Gap to close:** grants change at the next sign-in. For removals that must
> apply immediately, add a scheduled Microsoft Graph sync, which also syncs
> `manager`; see section 4.

## 4. Reporting lines: who leads whom

- Reporting lines come from the directory: the user's `manager` attribute
  through a scheduled Graph delta sync (_planned_), or an HR feed. Built
  today: a **CSV import** (`POST /admin/directory/import`) with a dry-run
  diff, effective-dated line and position changes, and **findings**
  (`coach_reports_to_coach`, `cycle`, `manager_not_found`, `self_manager`,
  `manager_departed`, …) returned with every run. A finding never fails the
  import, because HR is the truth (I29), and is not stored: the admin fixes it
  in HR and re-runs the dry run. Whether the Entra `manager` attribute is reliable is
  open question 24.
- They are **effective-dated** and never edited by product flows. An exclusion
  constraint guarantees **one manager per person at any date**.
- The owner's structural rules (only leaders have direct reports; coaches
  report to leaders; coaches never report to coaches) describe how the
  **organization** should be shaped. HR data may disagree. The app reports
  violations to the tenant admin and never rejects a sync, because HR is the
  source of truth. See open question 6 and the
  domain-expert questions.

## 5. Authorization: who may see and do what

Every check lives in pure functions in `packages/domain/src/policy` and is
tested as tables:

| Question                                         | Rule                                                                                                                                                                                                                        | Function                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Can O observe S for work on date D?              | O ≠ S; O was S's **direct** leader on D, or O held the coach grant and an **accepted** engagement with S on D, or O was designated for S for a window covering D (ADR 0020); O does not report to S                         | `checkObserverEligibility`                         |
| Who may see S's plan, progress and interactions? | S, S's active coaches, and S's whole leader chain                                                                                                                                                                           | `developmentAccess`                                |
| Who may read observation narratives about S?     | S, the observer who wrote it, S's coaches, S's **direct** leader. The wider chain sees levels only. A draft is visible only to its observer until signed.                                                                   | `canReadNarrative`                                 |
| Who may designate an observer for S?             | S's direct leader or an engaged coach, for at most 90 days; never S, never someone who reports to S; no overlapping pair in either direction (ADR 0020). Hidden in the web app unless `FEATURE_DESIGNATED_OBSERVERS` is on. | `checkDesignation`                                 |
| Who agrees S's plan?                             | S's coach, or S's leader if S has no coach. The leader chain may endorse but not block.                                                                                                                                     | `planAgreers` (server)                             |
| Who may edit S's plan? | Only S, while the plan is not closed (completed, canceled or expired). Focus skills only while it is a draft. | `editPlanRefusal` |
| Who may revise S's agreed plan? | S or an agreer, from proposed or active, until a closing review is confirmed | `planEvent` (server) |
| Who may add work to S's plan, or edit planned work? | S or an agreer, while the plan is open; edits only to planned work that is planned or underway | `addWorkRefusal`, `editWorkRefusal` |
| Who may set an individual value on S's work? | An agreer or a program owner, never S whatever grants S holds; the tenant must allow it; only planned, open work with no open or signed observation | `setValueRefusal` |
| Who records and confirms S's closing review? | S records it (active, paused, completed or expired plan); an agreer confirms it, after which it is fixed | `recordReviewRefusal`, `confirmReviewRefusal` |
| Who may propose coaching between C and E? | C or E, in either direction, when C holds the coach grant, is not E's direct leader, and the pair has no live engagement either way | `checkEngagementProposal` |
| Who sets the roles on an observation? | Only its observer, until signing; at most one primary | `resolveRatingRoles`, `writeDraft` (server) |
| Who may change the credit rules, skills and templates? | Program owners and tenant admins; each change is audited with before and after | `requireProgramAdmin` (server) |
| Who may send a lifecycle event?                  | A per-entity policy table (observer, subject, requester, admin), intersected with the XState machine                                                                                                                        | `permittedEvents`, `engagementPolicy`, `planEvent` |

**Visible to everyone in the tenant:** the published skill catalog (with any
values a skill sets for itself), published activity templates (with their
roles and values), the directory, and earned badges ("who can I learn
from"). A person's points are part of their progress and follow its rule.

**How it is enforced:**

1. The middleware turns the session cookie into `CurrentActor` (tenant,
   person, current grants).
2. Each use case loads relationships, asks the policy, then asks the
   lifecycle machine. `decide()` returns `Forbidden` for a policy refusal and
   `InvalidTransition` for a lifecycle refusal.
3. A resource the actor may not see is reported as `NotFound`, so nobody can
   probe for what exists.
4. The database adds structural guarantees:
   - composite tenant foreign keys;
   - an observation's basis must reference the exact reporting line or
     engagement between that observer and subject;
   - nobody can observe or credit themselves.
5. Responses carry `actions`, which already account for both policy and
   lifecycle, so the UI never decides permissions itself.

## 6. Tenancy

- One tenant is one firm, which is one Entra tenant (`tid`).
- The tenant comes **only** from the session, never from request input.
- Every row carries `tenant_id`, and composite foreign keys make cross-tenant
  references impossible at the database level (ADR 0009, `integrity.test.ts`).

## 7. Audit

Every sign-in, lifecycle transition, grant change on sign-in, privacy decision,
read of the audit trail or AI-usage report, credit-rule change, catalog change,
individual value, plan edit and closing review writes an `audit_event`. Each
event records:

- the actor (null for system actions);
- the event, with from and to states;
- a reason code, plus a link to a purgeable note when a human wrote a reason;
- the policy or question-set version.

The table is append-only, enforced by a trigger, and ordered by an identity
`seq` for export.

## 8. Threats considered

| Threat                                  | Mitigation                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session theft                           | HttpOnly and Secure cookies, hashed tokens, idle and absolute expiry, no tokens in the browser's JavaScript                                                                                                                                                                                                                                           |
| CSRF                                    | SameSite=Lax, required `x-requested-with`, Origin check                                                                                                                                                                                                                                                                                               |
| Login CSRF and code injection           | State, nonce and PKCE in a signed flow cookie                                                                                                                                                                                                                                                                                                         |
| Privilege drift after a role is removed | Grants reloaded on every request; sync gap noted in section 3                                                                                                                                                                                                                                                                                         |
| Cross-tenant access                     | Session-derived tenant, filtered queries, composite foreign keys                                                                                                                                                                                                                                                                                      |
| Self-crediting or collusion             | Database CHECKs (no self-observation, no self-credit); eligibility tied to dated edges; badges need two distinct observers and first-hand evidence. Designations between the same two people may not overlap in either direction (ADR 0020; `integrity-hub.test.ts › I21`). Reciprocal-pair exclusion on badge credit is designed (open question 17). |
| Dev sign-in in production               | Startup refuses `AUTH_MODE=dev` with `NODE_ENV=production`                                                                                                                                                                                                                                                                                            |
