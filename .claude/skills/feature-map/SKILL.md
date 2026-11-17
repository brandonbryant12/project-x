---
name: feature-map
description: Find a product feature, choose the checks for a change, and keep the feature map current. Use before changing a feature (to see its code, rules, tests and verify commands), when deciding what to verify for a diff, and whenever you add, change, defer or remove a feature, route, API endpoint, scenario test or QA journey. Routes to the QA skill and its journey playbooks.
---

# The feature map

`docs/feature-map/features.json` lists every product feature: state, personas,
who may and who must be refused, states worth checking, code, tables, agent
skills, the QA playbook, tests and verify commands. `docs/feature-map/README.md`
is generated from it. "Skills" there means agent instructions, not the
product's skill catalog.

## Find a feature

```sh
pnpm verify list                                   # all features and their state
pnpm verify list --state built --persona "Maya Chen"
pnpm verify show returned-request                  # everything about one, with its commands
```

Every command takes `--json`.

## Choose checks for a change

```sh
pnpm verify which --changed                        # files changed against main, by feature
pnpm verify which apps/server/src/features/program/credit-policy.ts
pnpm verify run credit-rules --kind tests
```

Then, with the QA environment running (`pnpm verify env start`), run the same
features with `--kind api` and `--kind browser`, and follow the
[QA skill](../qa/SKILL.md) for the parts no command can judge. Files that
belong to no feature are listed; if one changes behavior, map it.

## Update the map with your feature work (required)

Do this in the same change as the code. `pnpm verify check` runs in
`pnpm check` and CI and fails when the map falls behind.

1. **New or changed behavior.** Edit the feature's entry in `features.json`:
   `code` (web routes and folders, server modules, `group.endpoint` names,
   domain modules, tables), `permissions`, `states`, `tests` (by kind) and
   `gaps`. A new feature gets a new entry with a kebab-case `id`.
2. **New route, endpoint or scenario test.** Claim it in some feature;
   `pnpm verify check` names any route, endpoint, scenario test, playbook or
   journey check that no feature claims.
3. **Playbook.** Add or update the section under `.claude/skills/qa/journeys/`
   that the entry's `qa` points to (personas, steps in the UI, what to look at
   in the screenshots, refusals to try, commands). Anchors are the heading in
   lower case with spaces as hyphens.
4. **API journey check** for a changed journey: a module in
   `tools/verify/journeys/<name>.mjs` whose default export is
   `{ name, title, rerunnable, personas, run(t) }`. Use only the HTTP API and
   seeded personas through `t.as(name)`, assert with `t.ok`, `t.refused`,
   `t.equal` and `t.check`, include at least one refusal, and state at the top
   whether it can run twice on the same database. Read the server's scenario
   test for exact payloads. List its name in the entry's `verify.api`.
5. **Browser check.** Add routes and personas to `verify.browser`. They must be
   ones `apps/web/e2e/screenshots.spec.ts` captures; extend the spec first if
   a new screen is missing.
6. **Deferred or removed.** Set `state` to `deferred` or `not_built` with a
   `reason` and the document that records it (`recordedIn`), and drop its
   verify commands. `behind_switch` needs the `switch` variable read in
   `apps/server/src/platform/config.ts`; `api_only` needs a reason too.
7. Regenerate and check:

```sh
pnpm verify readme
pnpm verify check
pnpm verify run <id> --kind tests
```

Run the API journey you wrote against a seeded QA server before you call it
done, and run it twice if it claims to be re-runnable.
