# ADR 0017: A skill can mean different things in different roles: skill profiles, expectations by job family, and position history

- Status: **Deferred** (2026-11-17) for skill profiles and expectations.
  Position history (`job_family`, `person_position`, `subject_position_id`)
  stays built (see the amendments below).
- Date: 2026-11-16
- Builds on: [ADR 0006](./0006-identity-entra-roles-and-relationships.md), [ADR 0007](./0007-credit-only-from-signed-observations.md)

## Context

The owner asked how a skill should work when it means different things in
different roles. Take "Coaching your team" or "Developing a leader". For a
branch leader it means running one-to-ones and observing reports. For a
professional coach it is their craft. For a senior advisor mentoring juniors
it is something else again.

People can hold several of these at once (relationships are edges, ADR 0006).
People also get promoted or change role.

The seed shows the problem today: "Coaching your team", level 1, says "Holds
regular one-to-ones", which means nothing for a peer mentor.

Two more facts constrain the design:

- `person.title` and `business_function_id` are mutable and undated, so
  history cannot say who a person was when they earned something.
- The credit ledger is append-only. Anything a credit needs to pin must exist
  **before** real credit is written.

## Decision (proposed)

**Each skill keeps one identity, with optional _profiles_. A profile is a
named variant of the level descriptors and indicators, tied to the
_capacity_ in which the work was done. Firms set expected levels per job
family. Every credit pins both the profile and the person's effective-dated
position at the time.**

```
job_family(tenant_id, id, name, status)                   -- tenant taxonomy, from the HR feed
person_position(id, tenant_id, person_id, job_family_id, title, business_function_id,
                valid_from, valid_to, source)             -- effective-dated, no overlaps (btree_gist)

skill_profile(tenant_id, skill_version_id, key, name, capacity_kind, job_family_id?)
   -- 'core' always exists; capacity_kind: any | leader | coach | job_family
skill_level, skill_indicator          + profile_key        (default 'core')
role_expectation(tenant_id, job_family_id, skill_id, profile_key, expected_level,
                 valid_from, valid_to, set_by_id)

plan_skill, observation_rating, badge_award   + profile_key
credit_entry   + profile_key, subject_position_id          -- composite FK to person_position
```

**Rules**

- **Most skills only have `core`.** Client discovery means the same for
  everyone.
- **When to add a profile.** A keeper adds one only when at least two levels
  would describe different observable behavior. If all four levels differ and
  share no indicators, it is a different skill, not a profile. Cap: four
  profiles per skill. Adding a profile publishes a new skill version.
- **The observer picks the profile at signing,** among the profiles whose
  capacity the subject held on the interaction date. This is evaluated as of
  that date, exactly like eligibility. It defaults from the plan.
- **Badges are per skill, profile and level.** Badge evaluation filters
  credits by skill and profile.
- **Across a role change, nothing is revoked or re-scored.**
  - `core` credit carries forward. The _expectation_ changes, for example
    "Expected for Senior Advisor: Doing independently".
  - Profiled badges read with their context: "earned as a peer mentor,
    Senior Advisor, 2026".
  - A new profile starts from zero. In v1 there is no automatic equivalence
    between profiles.
- **Expectations by job family** suggest plan focus and show gaps. They are
  **never** used to rank people or to gate anything.

## Alternatives considered

- **Separate skills per role.** This fragments the catalog and "who can I
  learn from", and makes a promotion look like starting over.
- **Expectations only.** This changes the target level but not what the
  behavior is.
- **A role snapshot only.** This keeps history but still rates a mentor
  against a leader's ladder.

## Consequences

- Credit and badges gain one more dimension.
- There is a risk of profile sprawl. The keeper rule and the cap mitigate it.
- The design depends on reliable job-family data from the HR feed, not on
  free-text titles.
- **Sequencing:** add `person_position`, `subject_position_id` and the
  `profile_key` columns (defaulting to `core`) **before production data
  exists**. Profile authoring and expectations can follow.
- **Open for the owner and domain experts:** whether expectations by job family
  are wanted at all (HR question E1), and which skills get profiles first (A6).

## Amendment (2026-11-16): the columns land now, the behavior waits

The review's sequencing point holds: anything a credit pins must exist before
real credit is written. So the schema lands in this build round, and the
behavior does not.

**Accepted and built in the hub round (columns only):**

- `job_family` and `person_position` (effective-dated, one open position per
  person);
- `skill_profile` (reserved: no rows are written yet; `core` is implied by the default key);
- `profile_key`, defaulting to `'core'`, on `plan_skill`,
  `observation_rating`, `credit_entry` and `badge_award`;
- `subject_position_id` on `credit_entry`.

**Still proposed, waiting for HR (question E1) and the owner:**

- profile authoring by catalog keepers, and choosing a profile at signing;
- `role_expectation` and expectations by job family;
- any screen that shows a profile other than `core`.

Until then every credit is written with `profile_key = 'core'`, and nothing
reads `job_family` to suggest or gate anything.

## Amendment (2026-11-17): profiles deferred, columns removed

Nothing ever wrote a profile other than `core`, and HR has not answered E1.
Before any client data exists, `skill_profile` and every `profile_key` column
and check are dropped, and the badge uniqueness index is keyed on (person,
skill, level) again. Position history stays: credits still pin
`subject_position_id`. If profiles return, `profile_key` comes back as a
nullable column meaning "core" for existing rows, or the decision is made
before the pilot writes credit.
