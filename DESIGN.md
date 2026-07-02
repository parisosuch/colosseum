# Design system

The vocabulary for building UI in Colosseum. Reach for these before inventing
new classes — consistency is the whole point.

## Color

Use the semantic Tailwind tokens (backed by CSS variables in `globals.css`),
never raw `text-black/50 dark:text-white/50` pairs:

- `bg-background` / `text-foreground` — page surface and primary text
- `text-muted-foreground` — secondary text, placeholders, empty states
- `bg-card`, `bg-popover`, `bg-secondary`, `bg-accent` — surfaces
- `text-destructive` — delete / revoke affordances
- `border` — the one border color

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
  `text-destructive` (delete / revoke), `link` (inline navigation). Use
  `asChild` to wrap a `next/link`.
- **Page header:** `components/page-header.tsx` renders the
  `Colosseum / handle / channel` breadcrumb. Pass `crumbs`; omit `href` on the
  current (last) crumb.
- Prefer the existing `components/ui/*` shadcn primitives over new markup.
