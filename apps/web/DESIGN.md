# DESIGN.md — the "Quiet Ledger" contract for agents

This page is the design contract for the web app. Navigation (who sees what)
is `src/components/shell/nav.ts`; Home is `src/features/home/home-screen.tsx`
with three sections: "Waiting on you", "Your plan" and "Recently". "Your plan"
leads with **Try next time** (the latest signed "What next", in the
observer's words, with who and when), then one quiet progress line toward the
next badge, then the plan card. If this page and the code disagree, fix one
of them in the same change.

## Feel

Warm paper, ink, and a single brass note. It should read like a well-kept
record book, not a dashboard. Be dense where people scan (To sign, My team) and
spacious where they read or write (narratives, receipts).

## Tokens: use only these (`packages/ui/src/styles/tokens.css`)

- **Surfaces:**
  - `bg-canvas` is the page;
  - `bg-surface` is for cards;
  - `bg-sunken` is for wells and the evidence pane;
  - `bg-raised` is for overlays.
- **Text:**
  - `text-ink` is primary;
  - `text-ink-2` is secondary;
  - `text-ink-3` is for meta, never for body copy.
- **Borders:** `border-line` for structure, `border-line-strong` for inputs and
  dashed outlines.
- **Primary (pine ink):** primary actions, focus, active nav.
- **Brass (`brass`, `brass-soft`, `brass-ink`):** recognition moments only.
  This means badge receipts, the level-4 seal ring, and quote rules under a
  signed narrative. It is never used on buttons.
- **Status:** `success`, `warning`, `info` and `danger` each have `-soft` and
  `-ink` variants. Danger is only for destructive confirmations and failed
  saves. Deadlines are never red.
- **Type:**
  - `text-display` (32) and `text-h1` (24) are serif;
  - `text-h2` (18), `text-body` (15), `text-ui` (13.5) and `text-meta` (12)
    are sans;
  - the `narrative` utility is serif at 17/27.
- **Radii:** `rounded-control` (6), `rounded-card` (10), dialogs 14, pills full.
- **Spacing:** a 4px rhythm. Card padding is 20. Gaps between sections are
  32–40. The reading measure is at most 640px.
- **Never write:** raw hex, `oklch()` or `rgb()` in components, arbitrary
  colors, or inline styles for color.

## Serif is a voice

Use serif only where a human speaks or for the names of things that are
earned: narratives, quotes, page titles, plan titles. UI chrome, labels and
tables are sans.

## Components (`@repo/ui`)

- **Primitives:** Button (primary, secondary, ghost, soft), Card, Pill,
  Dialog/Sheet, Drawer, Tabs, SegmentedControl, Checkbox, form controls,
  Popover, Command, DropdownMenu, Tooltip, Collapsible, Skeleton, Kbd, toast.
- **Domain:**
  - `BadgeSeal`: earned badges only. `level={0}` renders the dashed "not yet"
    seal.
  - `LevelMeter`: a rating. Never use a seal for a rating.
  - `StatusPill`: labels and tones come from
    `src/lib/lifecycle-presentation.ts`.
  - `DueLabel`: shows dates, not countdowns.
  - `CreditFacts`: one credit's role, points and, when it matters, where the
    value came from ("Primary · 12 points · value set for this work"). Labels
    come from `CREDIT_ROLE_LABELS` and `CREDIT_SOURCE_NOTES`.
  - Also: `PersonAvatar`, `PersonChip`, `CriteriaChecklist`, `CoverageDots`,
    `LevelPicker`, `IndicatorRow`, `AssistantNote` and `AssistantPreRead`.

## Behavior rules

- **Lifecycle buttons come only from the view's `actions` array.** An action
  that isn't available is absent, not disabled.
- **Signing is never optimistic.** It shows "Posting to the record…", then the
  receipt. On failure: "Not signed. Nothing was posted. Try again." Everything
  else may be optimistic and offer an Undo toast.
- **Expiry never creates anxiety.** Show a date, not a countdown ("Open until
  Mon 30 Nov"); within three days a warning-toned dot; never red, never a
  ticking timer. A closed request always offers a way back.
- **Keyboard:** `⌘K` palette (people, skills, "I saw this: Daniel"); `G`
  then `H`/`I`/`D`/`P` to go; `L` to log, `O` to observe; `J`/`K` and `Enter`
  in To sign. Single keys are off while typing.
- **The assistant** always uses a dashed info-tinted border and the label
  "Assistant pre-read. An automated check; you decide."
  - Never pre-tick or pre-fill anything.
  - It only offers chips the human accepts.
  - Call `support.advisorySeen` when a check is shown.
- **No leaderboards, ranks, streaks or totals of people.** Team views show
  coverage only. Points appear only as one person's progress and as the value
  of their own credits, never summed across people.
- **Capabilities that are not lifecycle events** (edit plan, add work, edit
  work, set value, record or confirm the closing review) come from explicit
  flags on the view (`canEdit`, `canAddWork`, `canSetValue`, …), never from
  the client's own reading of roles.
- **Roles are the observer's.** The sign screen and "I saw this" offer a
  Primary / Secondary choice per rated skill to the observer only; the
  subject sees roles but never the control. The sign screen says in one quiet
  line what signing adds ("Signing adds …", or "Feedback only: signing adds
  nothing to the record.").
- **Avoid "AI slop":** gradient blobs, emoji, decorative icon-in-circle tiles,
  stat-card dashboards, centered heroes, and uniform card grids where a list
  reads better.

## Copy

Plain, adult, second person. Name people, not roles. No exclamation marks and
no "Great job!". Say "points" for the value of a credit, never as a score
or reward; say "Primary" and "Secondary" for roles, and "Observed before
roles" for credit signed before roles existed. The assistant says "appears to"
and never "I". Use plain words, not internal terms: "Log work I did", "I saw
this", "My plan", "People I coach", "times observed", "How this was earned"
(the [glossary](../../CONTEXT.md) maps them). The product name comes from
`src/lib/brand.ts`.

## Program screens

Program owners and tenant admins see a **Program** group in the navigation:
Adoption, **Credit rules** (`/program/credit-rules`), **Skill catalog**
(`/program/skills`) and **Activity templates** (`/program/templates`). They
are forms over the stored values, dense and plain:

- Every field says, in a hint beside it, what the calculation actually does
  with it (`src/features/program/credit-rules.ts` keeps the copy next to the
  arithmetic).
- A save asks for a reason where the server requires one and shows the change
  history with each field before and after.
- A broken stored policy is shown with its problems, not hidden behind
  defaults; the working defaults are shown for comparison only.

## Accessibility

- Visible focus rings.
- `LevelPicker` uses radio semantics.
- Dialogs trap focus. Review opens with focus on **Go back**.
- `aria-live="polite"` for autosave and assistant results; `role="alert"` for
  sign failures.
- Hit targets are at least 44px on touch.
- State is never conveyed by color alone.
- Respect reduced motion, the colour scheme and 200% zoom.

## Layout

- Page frame: 16/24/32px gutters, content capped at 1200px.
- Under 768px: dialogs become bottom drawers, tables become stacked rows, and
  the sign form becomes one scrolling accordion.
- From 1024px: the full sidebar; To sign and the sign screen use two panes.

## Look before you ship

With the API (:4400) and Vite (:5400) running:

```bash
pnpm --filter @repo/web screenshots                    # every persona, light/dark, desktop/mobile
PERSONAS="Maya Chen" ROUTES=home,development THEMES=light VIEWPORTS=desktop \
  pnpm --filter @repo/web screenshots                  # quick loop
```

Then open the PNGs in `apps/web/screenshots/<persona>/` and check spacing,
hierarchy, alignment, truncation and dark mode before you call UI work done.
