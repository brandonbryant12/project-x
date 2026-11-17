# UX brief (retired)

The long UX brief was cut on 2026-11-17 because it had drifted from the app.
The current design contract is [`apps/web/DESIGN.md`](../../apps/web/DESIGN.md);
who sees what in the navigation is `apps/web/src/components/shell/nav.ts`.

Code comments still cite sections of the old brief. They now live here:

| Cited as                     | Now                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| §1 information architecture  | `apps/web/src/components/shell/nav.ts`; Home is `apps/web/src/features/home/home-screen.tsx`       |
| §2 key screens               | The screens themselves under `apps/web/src/features`                                               |
| §3 interaction rules, pills  | [DESIGN.md](../../apps/web/DESIGN.md) behavior rules; `apps/web/src/lib/lifecycle-presentation.ts` |
| §4 visual direction, tokens  | [DESIGN.md](../../apps/web/DESIGN.md) tokens; `packages/ui/src/styles/tokens.css`                  |
| §5 copy                      | [DESIGN.md](../../apps/web/DESIGN.md) copy; the [glossary](../../CONTEXT.md) for user words        |
| §6 accessibility, responsive | [DESIGN.md](../../apps/web/DESIGN.md) accessibility and layout                                     |
