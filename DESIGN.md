# Design system

The vocabulary for building UI in Colosseum. Reach for these before inventing
new classes — consistency is the whole point.

## Color

Use the semantic Tailwind tokens (backed by CSS variables in `globals.css`),
never raw `text-black/50 dark:text-white/50` pairs:

- `bg-background` / `text-foreground` — page surface and primary text
- `text-muted-foreground` — secondary text, placeholders, empty states
- `bg-card`, `bg-popover`, `bg-secondary`, `bg-accent` — surfaces
- `border` — the one border color

Danger comes in two tokens, and picking the wrong one costs contrast:

- `text-destructive-text` — red used **as type** on the page: inline validation
  messages, delete/revoke affordances, destructive icons. Picked for contrast
  against `--background` (4.83:1 light, 7.19:1 dark).
- `bg-destructive` + `text-destructive-foreground` — the **fill** pair, for a
  solid destructive button. Reach for `variant="destructive"` on `Button` rather
  than spelling the pair out.

`text-destructive` on its own is the fill color used as type; it measures 1.98:1
in dark mode. Don't.

The only exception is `.link-subtle` (breadcrumb links), where the alpha pair
is spelled out once because token colors don't accept an opacity modifier.

## Typography

Geist Sans throughout; `font-mono` for code, URLs, and exact values. Semantic
classes live in `@layer components` (`globals.css`) — don't hand-roll
`text-Nxl font-light`:

| Class           | Scale                            | Use for                        |
| --------------- | -------------------------------- | ------------------------------ |
| `.text-display` | `text-2xl sm:text-4xl semibold`  | Page title / breadcrumb header |
| `.text-title`   | `text-2xl semibold`              | Section title within a page    |
| `.text-heading` | `text-lg medium`                 | Card / sub-section heading     |
| `.text-label`   | `text-xs medium uppercase muted` | Eyebrow label above a value    |
| `.text-caption` | `text-xs muted`                  | Timestamps, counts, captions   |

Body copy is the default (`text-sm` in dense UI, base in prose). Avoid
`font-light` — Geist reads thin and inconsistent below normal weight.

## Spacing

Stay on Tailwind's 4px scale. The page rhythm:

- Page padding: `p-6 sm:p-12`
- Between major sections: `space-y-8`
- Within a section / stacked fields: `space-y-4`
- Inline element gaps: `gap-2`
- Card / panel padding: `p-3`–`p-6`

Fixed media dimensions (preview tiles, avatars) may use explicit sizes; arbitrary
layout widths (`w-[350px]`) should not — use the scale or a responsive width.

## Components

- **Buttons:** always `components/ui/button.tsx`. Never a bespoke
  `<button className="text-sm underline">`. Variants: `default` (primary
  action), `secondary` (create), `outline` (copy / neutral), `ghost` +
  `text-destructive-text` (delete / revoke), `destructive` (the confirm button
  in a delete dialog — don't hand-roll `bg-destructive …` at the call site),
  `link` (navigation). Use `asChild` to wrap a `next/link`.
  - The `link` variant is for a **standalone** navigation affordance — one that
    sits on its own line, like a card's "View on GitHub". A link inside a
    sentence ("Don't have an account? Create account") stays a plain
    `<Link className="underline underline-offset-4">`: every button size carries
    a fixed height and horizontal padding, which mid-paragraph puts a button's
    box in the middle of the text.
- **Panels:** one recipe — `rounded-lg border` with `p-3`–`p-6`. For a surface
  that floats over the page rather than sitting in it, use
  `components/ui/card.tsx`, which is that recipe plus a shadow; its `p-6`
  sub-parts are defaults a call site can override with `className`.
- **Radius:** every step derives from `--radius` in `tailwind.config.ts` —
  `rounded-md` for controls (inputs, buttons, menu items), `rounded-lg` for
  panels and cards, `rounded-full` for avatars and count badges. Don't reach for
  an arbitrary `rounded-[5px]`; changing `--radius` is meant to move everything.
- **Loading:** `components/ui/skeleton.tsx` is the only placeholder. Pass sizing
  through `className`; don't hand-roll `animate-pulse rounded bg-muted`, which
  drifts to a different corner radius than the `Skeleton`s beside it.
- **Empty states:** `components/ui/empty-state.tsx` — dashed border, icon, a
  bold line and an explanatory one. Use it instead of a lone grey sentence, and
  give it an action where there is an obvious next step.
- **Page header:** `components/page-header.tsx` renders the
  `Colosseum / handle / channel` breadcrumb. Pass `crumbs`; omit `href` on the
  current (last) crumb.
- Prefer the existing `components/ui/*` shadcn primitives over new markup.
