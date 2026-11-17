---
name: feature-map
description: Find a product feature, choose the checks for a change, and keep the feature map current. Use before changing a feature (to see its code, rules, tests and verify commands), when deciding what to verify for a diff, and whenever you add, change, defer or remove a feature, route, API endpoint, test file or QA journey. Routes to the QA skill and its journey playbooks.
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
pnpm verify list --search "badge"                  # words in id, name, summary, states, code
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
`pnpm check` and CI. What it can and cannot catch:

- **It proves** that everything the map cites exists (paths, tests,
  `group.endpoint` names, tables, personas, playbook anchors, journey names,
  browser routes, the `pnpm` commands in the map, the README and these
  skills), that coverage is complete (every web route, API endpoint, product
  source file under an app's or package's `src`, migration, test file,
  playbook and journey check is claimed by some feature), and that the
  README matches `features.json`.
- **It cannot tell** that the words are still true: a changed rule,
  permission, refusal, state, payload or gap passes as long as the files
  exist. A journey that sends an old payload fails only when it runs.

So, by hand, for every feature the change touches: reread its `permissions`,
`states` and `gaps` and its playbook section against the new behavior, and
run its API journeys against a freshly seeded QA server (step 8).

1. **Find every entry the change touches.** `pnpm verify which --changed`
   (add `--base <ref>` for a range of commits) lists the features owning each
   changed file. An API model file routes to the features whose endpoints
   carry its schemas, a migration to the features that claim its tables, and
   shared plumbing to `shared-platform`. Documentation, agent instructions and
   the tool itself are named as such; any other file with no feature is
   unmapped code, and `pnpm verify check` fails on it. A changed request
   shape breaks the API journeys that send it.
2. **New or changed behavior.** Edit each touched entry in `features.json`:
   `code` (web routes and folders, server modules, `group.endpoint` names,
   domain modules, tables), `personas`, `permissions`, `states`, `tests` (by
   kind) and `gaps` (remove gaps the change closed). A new feature gets a new
   entry with a kebab-case `id`. The file is formatted by oxfmt, which keeps
   an object on one line only if it was written on one line: after a scripted
   edit, write it back compact (`JSON.stringify(map)`) and run
   `pnpm exec oxfmt docs/feature-map/features.json`, so untouched entries keep
   their layout.
3. **New route, endpoint, server module, web module, migration or test
   file.** Claim it in some feature's `code` or `tests` (a whole folder can be
   claimed). `pnpm verify check` names anything no feature claims.
4. **Playbook.** Add or update the section under `.claude/skills/qa/journeys/`
   that the entry's `qa` points to (personas, steps in the UI, what to look at
   in the screenshots, refusals to try, commands). Anchors are the heading in
   lower case with spaces as hyphens.
5. **API journey check** for a changed journey: a module in
   `tools/verify/journeys/<name>.mjs` whose default export is
   `{ name, title, rerunnable, personas, run(t) }`. Use only the HTTP API and
   seeded personas through `t.as(name)`, assert with `t.ok`, `t.refused`,
   `t.equal` and `t.check`, include at least one refusal, and state at the top
   whether it can run twice on the same database. Read the server's scenario
   test for exact payloads. Writes that carry a `version` must send the one
   the journey last loaded (a stale one is `Conflict`, which is worth a
   refusal step of its own). List its name in the entry's `verify.api`.
6. **Browser check.** Add routes and personas to `verify.browser`. They must be
   ones `apps/web/e2e/screenshots.spec.ts` captures; extend the spec first if
   a new screen is missing.
7. **Deferred or removed.** Set `state` to `deferred` or `not_built` with a
   `reason` and the document that records it (`recordedIn`), and drop its
   verify commands. `behind_switch` needs the `switch` variable read in
   `apps/server/src/platform/config.ts`; `api_only` needs a reason too.
8. Regenerate and check:

```sh
pnpm verify readme
pnpm verify check
pnpm verify run <id> --kind tests
```

Run the API journeys of every touched feature against a freshly seeded QA
server before you call it done, and again on the same database if they claim
to be re-runnable:

```sh
pnpm verify env seed
pnpm verify env start
pnpm verify run <id...> --kind api
pnpm verify run --all --kind api   # after a change to shared code or the seed
pnpm verify env stop
```
