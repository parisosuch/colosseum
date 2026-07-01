-- Cache the page description alongside the title so a captured URL block can be
-- pre-filled from the linked page's metadata (og:description / meta
-- description). See app/api/screenshot/route.ts and lib/colosseum/screenshot.ts.
alter table public.screenshot
  add column if not exists description text;
