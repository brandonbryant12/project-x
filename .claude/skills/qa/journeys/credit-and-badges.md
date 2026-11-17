# Credit and badges

Playbooks for weighted credit and badge receipts. Start with the
[QA skill](../SKILL.md); run everything against the QA environment on port 4410.

## Weighted credit

- **Personas:** Daniel Okafor (subject), Sam Rivera and Leo Okonkwo
  (observers), Maya Chen (badges in the seed).
- **Steps in the UI:** as Daniel log work and ask Sam and Leo about a primary
  and a secondary skill. As Sam sign; as Daniel open My plan and note the
  points; as Leo sign the same work; reload.
- **Look at:** each credit shows its role, points and source; progress rises
  once for the work and not again for the second observer; the points sentence
  on Home agrees with My plan.
- **Refusals:** the subject writing roles; two primaries on one observation.
- **Commands:**

```sh
pnpm verify run weighted-credit --kind tests
pnpm verify run weighted-credit --kind api
pnpm verify run weighted-credit --kind browser
```

## Badges and receipts

- **Personas:** Maya Chen (badge holder), Sam Rivera (her coach), Marcus Hill
  or Grace Liu (unrelated colleagues: no development access to Maya), Rhea
  Castillo (skip-level leader).
- **Steps in the UI:** as Maya open her profile and a badge's "How this was
  earned". As Sam open it; as Marcus open it from Maya's profile; as Rhea open
  it.
- **Look at:** for Maya and Sam: work grouped by piece of work with the
  counted credit marked; credit reversed since the award shown as reversed and
  left out of the total; the total set against the award's saved thresholds;
  legacy credit labelled as observed before roles; an individual value
  labelled. For Marcus: the badge, its level and the plain facts line (no
  points), then "How it was earned, observation by observation, is visible to
  Maya, their coaches and their leaders."; no points sentence, no thresholds,
  no list of work. For Rhea: the detail without the observers' words.
- **Refusals:** a colleague without development access gets no points,
  thresholds, work or words (`detailVisible: false`); a badge id under someone
  who does not hold it is `NotFound`.
- **Commands:**

```sh
pnpm verify run badges-receipts --kind tests
pnpm verify run badges-receipts --kind api
pnpm verify run badges-receipts --kind browser
```
