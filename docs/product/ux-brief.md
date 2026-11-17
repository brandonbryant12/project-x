# UX brief: "Quiet Ledger"

This is the design contract for the web app. Tokens live in
`packages/ui/src/styles/tokens.css`, and `apps/web/DESIGN.md` gives agents the
short version.

**Three decisions shape everything:**

1. **One app with one template per screen.** Navigation and Home add sections
   for the relationships a person has. There is no role switcher.
2. **The sign screen is two panes, "evidence | what you saw".** On phones it
   becomes a single scrolling accordion. The assistant never pre-ticks
   anything.
3. **Signing is the only action that is not optimistic.** It waits for the
   record to post, then shows a receipt.

## 1. Information architecture

### Shell

**Desktop (≥1024px)**

- Left sidebar, 248px wide, collapsible to a 56px icon rail.
- Top bar, 56px tall, holding:
  - breadcrumb;
  - search trigger (`⌘K`);
  - `Log interaction` (secondary button, everyone);
  - `Observe` (primary button, shown only if the person can observe at least
    one other person).

**Mobile (<768px)**

- Bottom tab bar: Home, Inbox, a centre action, Growth, More.
- The centre action opens a sheet offering "I saw this" and "Log interaction".

### Sidebar groups

Groups with no items are not rendered.

| Group            | Items                          | Shown when                                          |
| ---------------- | ------------------------------ | --------------------------------------------------- |
| (none)           | Home; Inbox (count)            | Home always; Inbox if the person can observe anyone |
| My growth        | Development, Timeline, Profile | Always                                              |
| People I support | My team; Coachees              | Has direct reports; has an engagement               |
| Explore          | Skills, Activities, People     | Always                                              |
| Manage           | Catalog; Admin                 | Catalog keeper; Tenant admin                        |

The Inbox count is the number of things _waiting on you_, not unread items. It
is a neutral grey number, never a red dot.

### URLs

| Area             | Routes                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Home             | `/`                                                                                                    |
| Inbox            | `/inbox?tab=requests\|drafts\|signed`                                                                  |
| Observations     | `/observations/new?for=:personId`; `/observations/:id` (sign or read; becomes the receipt once signed) |
| Development      | `/development` (an activity detail route is _planned_)                                                 |
| Logging          | A dialog over the current page, from the shell or a plan activity (a `/log` route is _planned_)        |
| Timeline         | `/timeline`                                                                                            |
| People           | `/people`; `/people/:id`; `/people/:id/badges/:badgeId`                                                |
| Team             | `/team`; `/team/:personId`                                                                             |
| Coaching         | `/coaching`                                                                                            |
| Catalog          | `/catalog/skills`; `/catalog/skills/:slug`; `/catalog/activities`                                      |
| Manage and admin | `/admin/audit`; `/admin/ai-usage` (catalog management under `/manage` is _planned_)                    |

### Home: what needs me today

The layout is a 720px main column with a 320px right rail.

1. **Greeting line** in serif ("Good morning, Maya."), followed by one
   sentence ("Two things are waiting on you.").
2. **Needs you**: one merged queue across all relationships, sorted by closing
   date. Each row shows avatar, description, relationship tag ("your report",
   "coachee", "your plan"), `DueLabel` and one primary action. At most 5 rows.
3. **Your next step**: the closest badge criterion, stated in plain words.
4. **Recently**: quotes from signed narratives, and badges earned by people
   you support.
5. **Right rail**: plan summary, coach, and the "I saw this" shortcut.

| Persona | What "Needs you" contains                                           |
| ------- | ------------------------------------------------------------------- |
| Advisor | Returned observations, plan proposals, interactions with no request |
| Coach   | Requests to sign, drafts, engagement proposals                      |
| Leader  | Requests to sign, plans to review                                   |

A leader who is also developing sees all of this in one queue. Never split it
into "modes".

**Being built in this round** (see the
[path-to-A plan](../reviews/2026-11-16-path-to-a.md) § 2): Home gains two
bands around "Needs you".

- **Today**: conversations today and planned work naming you as observer or
  due from you. It needs no calendar.
- **This week**: for observers, up to three people to observe, each with a
  reason, never a ranking; commitments due; for advisors, the next-step
  benchmark and who agreed to observe what.

## 2. Key screens

### My Development (`/development`)

- **Header**: plan title, `StatusPill`, period, coach and leader chips, and an
  overflow menu with the plan's lifecycle actions.
- **Main column (8/12)**: activity rows. Each row shows:
  - template icon and title;
  - skill chips;
  - "3 interactions · 2 observed";
  - a `Log` button.

  Expanding a row shows its interactions and their observation status.

- **Sticky rail (4/12): "Toward badges"**. For each focus skill there is a
  `CriteriaChecklist`: demonstrations, observers, first-hand share and time
  span, each with a check or an open circle and a phrase such as "2 of 3
  interactions".
  - There are no points. Each criterion row (demonstrations, observers, first-hand, weeks) has the same weight. There is no big
    number and no ring.
  - Below the checklist sits one benchmark sentence.
- **Empty state**: "Start from a template" and "Ask my coach to propose one".

### Skill detail (`/catalog/skills/:slug`)

- **Hero**: `BadgeSeal` (64px; neutral outline if not held), name in 32px
  serif, definition, domain chip, "Add to my plan".
- **Levels**: four tabs (an accordion on mobile). Each tab has a "what this
  looks like" paragraph and the indicators. These are the same strings the
  observer ticks.
- **Your standing**: the checklist, shown if the skill is in the person's plan.
- **Who can I learn from**: people holding the badge, "Teaching others" first.
- **Activities that build this**: template cards.

### Log interaction (Dialog on desktop, Drawer on mobile)

One screen, four fields, about 30 seconds to complete:

1. **Activity**: a combobox, prefilled when opened from a row.
2. **When**: chips for Today, Yesterday and Pick.
3. **What happened**: helper text reads "Describe what you did, not who the
   client was. No client names or account details."
4. **Who was there to see it**: optional.

The footer has `Save` and `Save and request observation` (`⌘Enter`).

The privacy screen runs on save. A hold shows as an info-toned
`AssistantNote`, never a red error.

### Request observation

- **Observers**: only eligible people are listed, grouped under "Your leader"
  and "Your coaches". A hint appears where it helps, for example "Would count
  as your second observer."
- **Mode**: a segmented choice between "They were there" (direct), "They'll
  review what I share" (recorded) and "We'll debrief" (debrief).
- **Skills**: up to 3, prefilled from the activity. Assistant suggestions
  appear as dashed "Suggested" chips.
- **Note**: optional, up to 280 characters.
- **Footer**: "Open for 14 days, until Mon 30 Nov. You can withdraw any time."
- Sending is optimistic: a toast appears with Undo.

### Sign observation (`/observations/:id`), the centrepiece

**Desktop: two panes, each scrolling independently, no page scroll.**

**Header**

- back to Inbox;
- "Observation for Daniel Okafor";
- activity;
- `StatusPill` and `DueLabel`;
- autosave text ("Saved just now");
- overflow menu: Return, Decline.

**Left pane (42%, sunken surface): "What happened"**

- `EvidenceCard`: description, date, mode, and the requester's note.
- "Daniel asked you to look at", followed by skill chips.
- "Earlier observations", collapsed by default so the observer isn't anchored
  to past ratings.
- The `AssistantPreRead` panel at the bottom.

**Right pane (58%): "What you saw", 640px maximum measure**

1. **Skills** (up to 3): `IndicatorRow` checkboxes, **never pre-ticked**.
   Where the assistant found a match, a dashed marker reads "Evidence appears
   to address this", with a tooltip naming the sentence.
2. **Level observed**: a four-segment `LevelPicker` (radio group) for each
   skill, showing the descriptor of the selected level.
3. **Narrative**: "What I saw" and "What next", typed in serif. Below sits a
   quiet three-part meter, "Specific behavior · Effect · Next step". It is
   advisory and never blocks.
4. **Sticky sign bar**: a summary ("2 skills · 5 indicators · Doing
   independently"), `Return` and `Review and sign`.

**Review and receipt**

- **Review dialog**, initial focus on `Go back`:
  - "You're signing that you observed Daniel Okafor on 12 Nov and saw:"
  - skills, levels and narrative;
  - "Signing is permanent and posts credit to Daniel's record."
  - buttons: `Go back`, `Sign observation`.
- **After signing**, the dialog cross-fades into a **receipt**:
  - what was credited;
  - "This completed Daniel's Discovery · Doing independently badge.";
  - `Next in inbox` (`J`) and `Done`.

**Minimum to sign**

- at least 1 indicator ticked;
- a level for each skill;
- at least 40 characters in "What I saw".

A narrative nudge never blocks. A privacy hold does.

**Assistant pre-read panel**

- **Styling**: dashed 1px border, info-tinted background, scan-search icon.
- **Copy**: titled "Assistant pre-read", with the subtitle "An automated
  check. You decide."
- **Rows**: indicators addressed, narrative specificity, privacy.
- **Behavior**: collapsible. It never uses the primary colour and never
  fills in the form.

**Mobile "I saw this" (`/observations/new`): under 60 seconds**

A single-scroll accordion of five steps:

1. **Who**: recent people as large avatar chips.
2. **Context**: an activity chip from their plan, or "Something else". Mode
   defaults to "I was there".
3. **Skills and indicators**: 48px rows.
4. **Level**: a 2×2 grid of large buttons.
5. **Narrative**: OS dictation works here.

Each completed section collapses to a one-line summary, so the form gets
shorter as you go. The sign bar is pinned above the safe area. It names
what's missing, for example "Add what you saw to sign". Review opens in a
bottom sheet.

### Inbox (`/inbox`)

- **Tabs**: Requests (the default), Drafts, Signed.
- **Desktop layout**: a list plus a preview pane.
- **Rows**: avatar, name, activity, skills, the first line of evidence, and a
  `DueLabel`.
- **Grouping**: "Closing this week", then "Later". No red anywhere.
- **Keys**: `J`/`K` to move, `Enter` to open.
- **Decline reasons**: "I wasn't there", "Not enough to go on", "Someone else
  is better placed", "Other".

### Profile and badge receipts (`/people/:id`)

- **Header**: avatar, name in serif, title, function, and relationship chips
  ("Your coach").
- **Badges**: a grid of `BadgeSeal` cards, visible to the whole tenant.
- **Receipt sheet**:
  - the seal and the date earned;
  - the criteria as facts: "3 demonstrations · 2 observers · 2 seen first-hand · over 7 weeks";
  - a timeline of the contributing observations.
- **Narratives as serif pull quotes**, shown only to permitted viewers. Other
  viewers see observer names and dates plus the line "Narratives are visible
  to Daniel, his coaches and his leaders."

### My Team (`/team`)

This is a table, not a dashboard. No totals, no sorting by progress, no rank.

**Columns**

- Person;
- Plan (pill and focus skills);
- Waiting on you;
- Last observed;
- Coverage: one dot per plan skill, filled if observed in the last 6 weeks.

**Behavior**

- Sorted alphabetically by default. The only other sort is "Waiting on you".
- Above the table, gaps are framed as the leader's to-dos: "4 requests are
  waiting on you", "2 people haven't been observed in 6 weeks".

### Catalog

- **Browsing**: search, filters (domain, in my plan) and a card grid.
- **Skill card**: seal outline, definition, "18 people hold a badge".
- **Activity card**: icon, title, duration, skills, "Add to plan".
- **Keeper management**: dense tables with Draft, Published and Retired pills.
  Publishing shows "Affects 42 active plans".

## 3. Interaction rules

- **Keyboard**:
  - `⌘K` palette (people, skills, actions; typing a name offers "Observe
    Daniel");
  - `G` then `H`/`I`/`D`/`T`/`P` to navigate;
  - `L` to log, `O` to observe;
  - `J`/`K` and `Enter` in lists;
  - `?` opens the shortcut sheet.

  Single-key shortcuts are disabled while typing in an input.

- **Optimistic, with an Undo toast**: logging, requesting, withdrawing, plan
  edits.
- **Drafts autosave** after 800ms. Status reads "Saving…", "Saved just now" or
  "Offline, kept on this device".
- **Signing is not optimistic.** The button reads "Posting to the record…".
  On failure: "Not signed. Nothing was posted. Try again." The draft is kept.
- **Lifecycle actions** come from the server's `actions` array. Actions that
  aren't valid are **absent, not disabled**.
- **`LifecycleTimeline`** on each detail page lists who did what, and when.
- **Expiry never creates anxiety.**
  - Show a date, not a countdown: "Open until Mon 30 Nov".
  - Within 3 days: "Closes Friday", with a warning-toned dot.
  - On the last day: "Closes today".
  - No ticking timers, no red, no pulsing.
  - Expired items read "Closed" and always offer a way back.

### Status pills

Pills are written in sentence case, with a 6px dot plus text on a tinted
background.

| Observation | Pill            | Tone         |
| ----------- | --------------- | ------------ |
| requested   | Requested       | neutral      |
| drafting    | In progress     | info         |
| returned    | Returned to you | warning-soft |
| signed      | Signed          | success      |
| declined    | Declined        | neutral      |
| withdrawn   | Withdrawn       | muted        |
| expired     | Closed          | muted        |
| voided      | Voided          | muted        |

| Plan state        | Pill                  | Tone         |
| ----------------- | --------------------- | ------------ |
| draft             | Draft                 | neutral      |
| proposed          | Waiting for agreement | info         |
| active            | Active                | primary-soft |
| paused            | Paused                | neutral      |
| completed         | Completed             | success      |
| canceled, expired | Canceled / Closed     | muted        |

## 4. Visual direction: Quiet Ledger

Warm paper, ink, and a single brass note. It should feel like a well-kept
record book in a calm office.

- Dense where people scan, spacious where they read and write.
- Borders do the structural work. Shadows only lift overlays.
- **Serif only where a human voice speaks**: narratives, quotes, the names of
  things earned.
- **Brass only at recognition moments**, never on buttons.

### Colour tokens (oklch)

| Token              | Light          | Dark           |
| ------------------ | -------------- | -------------- |
| bg                 | 0.985 0.004 85 | 0.17 0.008 70  |
| surface            | 1 0 0          | 0.21 0.008 70  |
| surface-sunken     | 0.965 0.006 85 | 0.145 0.008 70 |
| surface-raised     | 1 0 0          | 0.245 0.009 70 |
| border             | 0.915 0.008 85 | 0.30 0.010 70  |
| border-strong      | 0.85 0.010 85  | 0.38 0.010 70  |
| text-1             | 0.24 0.012 60  | 0.94 0.008 85  |
| text-2             | 0.45 0.012 60  | 0.76 0.010 85  |
| text-3             | 0.54 0.010 60  | 0.62 0.010 85  |
| primary (pine ink) | 0.42 0.07 175  | 0.74 0.09 175  |
| primary-hover      | 0.37 0.07 175  | 0.79 0.09 175  |
| primary-fg         | 0.985 0.004 85 | 0.18 0.02 175  |
| primary-soft       | 0.95 0.025 175 | 0.28 0.04 175  |
| accent (brass)     | 0.74 0.12 80   | 0.80 0.11 82   |
| accent-soft        | 0.96 0.035 85  | 0.27 0.04 80   |
| accent-text        | 0.48 0.09 70   | 0.84 0.10 82   |
| success            | 0.55 0.11 155  | 0.72 0.12 155  |
| warning            | 0.68 0.14 55   | 0.78 0.12 60   |
| danger             | 0.55 0.17 27   | 0.70 0.15 27   |
| info               | 0.55 0.10 245  | 0.72 0.10 245  |

- **Soft status backgrounds** use the same hue at L 0.96 / C 0.03 in light and
  L 0.27 / C 0.04 in dark.
- **Status text on a soft background** uses L 0.42 in light and L 0.82 in dark.
- **Focus ring**: 2px primary with a 2px offset.
- **Danger** is reserved for destructive confirmations and failed saves. It is
  never used for deadlines.

### Typography

Google Fonts: **Geist** (UI), **Newsreader** (narratives, quotes, display) and
**Geist Mono** (figures). Tables use `tabular-nums`.

| Role      | Size / line height | Weight | Face       |
| --------- | ------------------ | ------ | ---------- |
| Display   | 32/40, -0.01em     | 500    | Newsreader |
| H1        | 24/32              | 500    | Newsreader |
| H2        | 18/26              | 600    | Geist      |
| Body      | 15/22              | 400    | Geist      |
| Narrative | 17/27              | 400    | Newsreader |
| UI small  | 13/18              | 500    | Geist      |
| Meta      | 12/16, +0.02em     | 500    | Geist      |

### Shape, space and motion

**Radii**

- 6px for controls;
- 10px for cards;
- 14px for dialogs and sheets;
- full for pills and avatars.

**Spacing**

- 4px base unit;
- gutters 16/24/32;
- card padding 20;
- section gap 32;
- rows 44 (one line) and 56 (two lines);
- reading measure 640px maximum.

**Shadows**

- sm: `0 1px 2px oklch(0.2 0.01 60 / .06)`.
- overlay: `0 8px 24px -6px oklch(0.2 0.01 60 / .12), 0 2px 6px oklch(0.2 0.01 60 / .06)`.
- In dark mode, use no shadows. Use the raised surface plus a border instead.

**Motion**

- Durations:
  - 120ms for hover and press;
  - 180ms for popovers and pills;
  - 260ms for dialogs and sheets;
  - 480ms for recognition only.
- Easings:
  - standard `cubic-bezier(.2,0,0,1)`;
  - exit `cubic-bezier(.4,0,1,1)`;
  - seal settle `cubic-bezier(.34,1.3,.64,1)`.
- Nothing loops. With reduced motion, everything becomes a 120ms opacity
  change.

### BadgeSeal

The badge is a circular seal, like an embossed stamp, drawn in SVG. No
medals, stars, ribbons or shields.

**Anatomy**

- The centre holds a line glyph for the skill, tinted by a muted domain hue
  (C ≤ 0.07).
- Level is encoded twice, and never by colour alone: by the outer ring's four
  arcs (1–4 filled) and by the fill.

**Levels**

| Level               | Fill                         | Arcs filled | Extra                    |
| ------------------- | ---------------------------- | ----------- | ------------------------ |
| Learning            | Outline only                 | 1           |                          |
| Doing with support  | Soft tint                    | 2           |                          |
| Doing independently | Solid fill, light glyph      | 3           |                          |
| Teaching others     | Solid fill                   | 4           | A 1.5px brass outer ring |
| Not yet earned      | None; dashed neutral outline | 0           | Never "locked" art       |

**Sizes**

- Available sizes: 24, 40, 56 and 96px.
- At 24px, drop the glyph and keep the arcs.
- Always show the level name in text next to the seal.

## 5. Copy

Plain, adult, second person. Name people, not roles. State facts and the next
step. No exclamation marks, no "Great job!", no urgency words. Say
"record", never "ledger" or a score. The assistant is always "the assistant",
always hedges with "appears to", and never says "I".

| Moment                        | Copy                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home, empty                   | "Nothing is waiting on you. A good day to notice someone doing something well."                                                                    |
| No plan                       | "You don't have a plan yet. Start from a template, or ask your coach to propose one."                                                              |
| Activity with no interactions | "Nothing logged here yet. After your next client meeting, take a minute to note what you did."                                                     |
| Inbox, empty                  | "You're all caught up. If you saw someone do good work today, you can start an observation yourself."                                              |
| Timeline, empty               | "Your timeline starts with your first logged interaction."                                                                                         |
| No badge holders              | "No one holds this badge yet. You could be the first."                                                                                             |
| Request sent                  | "Request sent to Sam. Open until Mon 30 Nov."                                                                                                      |
| Logging reminder              | "Logging adds this to your plan. Credit comes when someone who saw it signs."                                                                      |
| Review header                 | "You're signing that you observed Daniel Okafor on 12 Nov."                                                                                        |
| Sign caution                  | "Signing is permanent and posts credit to Daniel's record."                                                                                        |
| Signed                        | "Signed. Daniel will see your words today."                                                                                                        |
| Badge earned                  | "You earned Discovery · Doing independently. Four people saw it over seven weeks."                                                                 |
| Quote lead-in                 | "In Sam's words:"                                                                                                                                  |
| Benchmark                     | "One more observation from a second observer to earn Discovery · Doing independently."                                                             |
| Request closed                | "This request closed on 30 Nov without a signature. Your interaction is still in your plan. You can ask again, or ask someone else."               |
| Returned                      | "Sam sent this back with a note: '…'"                                                                                                              |
| Pre-read header               | "Assistant pre-read. An automated check; you decide."                                                                                              |
| Narrative nudge               | "This reads as general praise. Adding what Daniel did and what it led to will make it more useful to him. You can sign as it is."                  |
| Privacy hold (author)         | "Held for privacy. This appears to include client details, so it hasn't been shared with anyone. Remove names and account information to send it." |
| Privacy hold (observer)       | "Daniel's description is on hold for a privacy check and isn't visible yet. He's been asked to revise it."                                         |

## 6. Accessibility and responsive behavior

### Accessibility (target: WCAG 2.2 AA)

- **Contrast**: text tiers need at least 4.5:1. Verify `text-3` and the pill
  text in particular.
- **State is never colour-only.**
- **Targets**: at least 44px on touch and 32px with a pointer. An indicator
  row's label wraps a real checkbox.
- **`LevelPicker`** is a radio group with a roving tabindex.
- **Dialogs** trap focus and return it to the trigger. The sign review opens
  with focus on `Go back`.
- **Announcements**:
  - autosave status and assistant results use `aria-live="polite"`;
  - a sign failure uses `role="alert"`.
- **Never time out a draft.**
- **Respect user settings**: reduced motion, the colour scheme (with a manual
  toggle), and 200% zoom without horizontal scrolling.

### Responsive

| Width      | Layout                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| <768px     | Bottom tabs. Dialogs become drawers and tables become cards. The sign form uses the accordion. The sign bar respects the safe area. |
| 768–1023px | Icon rail. On the sign screen, the evidence stacks above the form.                                                                  |
| ≥1024px    | Full sidebar. Inbox and sign screen use two panes.                                                                                  |
| ≥1440px    | Content is capped at 1200px.                                                                                                        |

## 7. "Wow but cheap", in priority order

1. **The receipt moment.** The review morphs into the receipt and the seal
   settles in 480ms. This is the only celebratory motion in the product.
2. **Narratives in serif everywhere.**
3. **Plain-sentence benchmarks** instead of progress bars.
4. **The collapsing accordion** on the mobile sign flow.
5. **A `⌘K` palette that understands intent.**
6. **Honest autosave text.**
7. **"Shared with" popovers** on every private section.
8. **Skeletons that match the layout, plus `J` to jump to the next item.**
