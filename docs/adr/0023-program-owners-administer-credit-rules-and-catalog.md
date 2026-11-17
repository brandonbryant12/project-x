# ADR 0023: Program owners change the credit rules and the catalog at run time, with an audit record

- Status: Accepted
- Date: 2026-11-17
- Builds on: [ADR 0007](./0007-credit-only-from-signed-observations.md), [ADR 0015](./0015-audit-trail-and-ai-decision-records.md), [ADR 0021](./0021-program-owner-and-adoption-view.md)

## Context

Weighted signed credit (ADR 0007, amendment of 2026-11-17) is only flexible if
the people who own the program can change its numbers themselves. Before this
decision the skill catalog and the activity templates came only from the seed,
and the tenant's badge numbers sat in `tenant.settings` with nothing in the
server that wrote them. Any change meant a developer editing seed data.

The owner asked for a system that domain experts control, including point
values and individual activities. Who those experts are in the firm is not
decided (open question 31). The role that runs the program today is the
`program_owner` grant (ADR 0021), which sees aggregates and nothing per
person.

## Decision

**Program owners and tenant admins administer the tenant's credit rules, the
skill catalog and the activity templates from the app, at run time. Every
change is checked by the same domain rules the server enforces, compared and
set on the version the editor loaded, and written in one transaction with an
audit event that records each changed field before and after. Rules and
values apply to credit signed from then on; nothing already signed is
re-valued.**

### Who

- `program_owner` or `tenant_admin` (`requireProgramAdmin` in
  `apps/server/src/features/program/changes.ts`). Everyone else gets
  `Forbidden`. The role-by-action matrix test covers each program action
  (I31).
- A program owner still sees nothing per person through these screens (ADR
  0021). The one per-person power a program owner has is setting an individual
  value on one piece of planned work (ADR 0007), which the API allows and the
  web app does not yet offer them, because they cannot open other people's
  plans.

### What is built

All under `/api/program` (`packages/api/src/groups/program.ts`), with the
screens Credit rules, Skill catalog and Activity templates in the Program
section of the navigation.

- **Credit rules** (`apps/server/src/features/program/credit-policy.ts`).
  Read the stored policy exactly as stored, with its problems when it is
  broken, the working defaults for comparison and the last saved changes.
  Replace the whole policy with a reason of at least 10 characters. A save
  that names an old version gets `Conflict`; an invalid value gets a
  field-level `Unprocessable`. A broken stored policy can be repaired by a
  save; reading never repairs it.
- **Skills** (`apps/server/src/features/program/skills.ts`).
  - List every skill in any state; create a draft with four empty levels; edit
    the name, summary, domain, outcome, tags and the draft definition.
  - `PUBLISH` writes the draft as the next immutable `skill_version` (version
    1 the first time). Publishing needs four levels, each with a summary and
    at least one indicator. A published skill can carry a new draft and be
    published again as its next version; observations keep the version they
    pinned. Indicator ids are new in every version; lineage keys carry over,
    and the audit event lists the keys added and removed.
  - `RETIRE` stops new use: plans, work, templates and observations accept
    only published skills, while history still shows a retired one.
    `DISCARD` drops a draft that was never published.
  - The slug is fixed when the skill is created, so links survive a rename.
    The name, summary, domain and outcome of a published skill stay editable,
    and each edit is audited (open question 39 asks whether renaming should be
    allowed).
  - A skill's own values (primary points, secondary points, badge points,
    primary-points minimum; empty uses the tenant's) need a reason and apply
    to credit signed afterwards.
- **Activity templates** (`apps/server/src/features/program/templates.ts`).
  - List, create a draft, edit the name, description, kind, observer tip,
    typical minutes and skills, each with a role and an optional value.
    Each skill once, at most one primary, at most six skills, all published.
  - `PUBLISH` needs at least one skill, every one published. A published
    template can still be edited; there is no template versioning. Its roles
    and values are copied onto an activity when work is added
    (`addActivity`), so an edit affects only work added afterwards, and
    signing never reads the live template.
  - `RETIRE` and `DISCARD` as for skills.
- **Audit.** Entity types `credit_policy` (entity id: the tenant),
  `skill` and `activity_template`. Each event records the changed fields
  before and after. A required or optional reason is a purgeable note of kind
  `policy_change` or `catalog_change`. The screens show each item's change
  history from these events.

The catalog item lifecycle (`packages/domain/src/lifecycles/catalog-item.ts`)
gained one transition: `PUBLISH` on a published item, guarded by a complete
draft.

### What is deliberately not built

- A second approver for any change (open question 31).
- Re-evaluating awards when a rule changes. A policy save never awards or
  revokes anything (ADR 0007).
- Versioned templates. A template edit is audited and applies to work added
  afterwards; work already planned keeps the values it copied.
- Import or export of the catalog, a catalog shared between tenants, and
  per-person views for program owners.
- Program entries in the command palette.

## Alternatives considered

- **Keep the catalog and numbers in seed data.** Every change would need a
  developer and a deployment, and nothing would record who changed what or
  why.
- **A new `catalog_keeper` grant.** A grant like this existed once and was
  removed. Until the firm names its domain experts, the program owner is the
  closest existing role; adding a grant later is cheap.
- **Let tenant admins only.** Tenant admins release privacy holds and read the
  audit trail; running the program is a different duty. Both may do it today
  because the firm has not said who should.
- **Re-read the live template at signing.** A template edit would then
  re-value work already planned, and a participant could attach any template
  to pick up its values.

## Consequences

- A program owner can tune values and criteria without a developer, and every
  change can be explained afterwards from the audit trail.
- A mistaken loosening awards nothing until the next signed credit for that
  skill, and a mistaken tightening revokes nothing.
- A broken stored policy stops signing for that tenant until it is repaired on
  the Credit rules screen (see the
  [incident response runbook](../runbooks/incident-response.md)).
- **This decision was wrong if** program owners change values often without
  domain experts, if changes are made to fix a single person's progress, or if
  the firm needs a second approver before any change takes effect.
