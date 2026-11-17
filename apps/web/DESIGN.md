# DESIGN.md — the "Quiet Ledger" contract for agents

This page is the short form. The binding spec is
[docs/product/ux-brief.md](../../docs/product/ux-brief.md). If they disagree,
the brief wins and this page needs fixing.

## Feel

Warm paper, ink, and a single brass note. It should read like a well-kept
record book, not a dashboard. Be dense where people scan (Inbox, Team) and
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
  - Also: `PersonAvatar`, `PersonChip`, `CriteriaChecklist`, `CoverageDots`,
    `LevelPicker`, `IndicatorRow`, `AssistantNote` and `AssistantPreRead`.

## Behavior rules

- **Lifecycle buttons come only from the view's `actions` array.** An action
  that isn't available is absent, not disabled.
- **Signing is never optimistic.** It shows "Posting to the record…", then the
  receipt. Everything else may be optimistic and offer an Undo toast.
- **The assistant** always uses a dashed info-tinted border and the label
  "Assistant pre-read. An automated check; you decide."
  - Never pre-tick or pre-fill anything.
  - It only offers chips the human accepts.
  - Call `support.advisorySeen` when a check is shown.
- **No leaderboards, ranks, streaks or totals of people.** Team views show
  coverage only.
- **Avoid "AI slop":** gradient blobs, emoji, decorative icon-in-circle tiles,
  stat-card dashboards, centered heroes, and uniform card grids where a list
  reads better.

## Copy

Plain, adult, second person. Name people, not roles. No exclamation marks and
no "Great job!". Prefer "record" to "points". The assistant says "appears to"
and never "I". Use the brief's exact strings for empty states and key moments.
The product name comes from `src/lib/brand.ts`.

## Accessibility

- Visible focus rings.
- `LevelPicker` uses radio semantics.
- Dialogs trap focus. Review opens with focus on **Go back**.
- `aria-live="polite"` for autosave and assistant results; `role="alert"` for
  sign failures.
- Hit targets are at least 44px on touch.
- State is never conveyed by color alone.
- Respect reduced motion.

## Look before you ship

With the API (:4400) and Vite (:5400) running:

```bash
pnpm --filter @repo/web screenshots                    # every persona, light/dark, desktop/mobile
PERSONAS="Maya Chen" ROUTES=home,development THEMES=light VIEWPORTS=desktop \
  pnpm --filter @repo/web screenshots                  # quick loop
```

Then open the PNGs in `apps/web/screenshots/<persona>/` and check spacing,
hierarchy, alignment, truncation and dark mode before you call UI work done.
