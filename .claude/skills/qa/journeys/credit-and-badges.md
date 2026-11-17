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

- **Personas:** Maya Chen (badge holder), Grace Liu (an unrelated colleague),
  Sam Rivera (her coach).
- **Steps in the UI:** as Maya open her profile and a badge's "How this was
  earned". As Grace open the same receipt; as Sam open it.
- **Look at:** work grouped by piece of work with the counted credit marked;
  the total set against the award's saved thresholds; legacy credit labelled
  as observed before roles; an individual value labelled.
- **Refusals:** Grace sees levels and work but not the observers' words.
- **Commands:**

```sh
pnpm verify run badges-receipts --kind tests
pnpm verify run badges-receipts --kind browser
```
