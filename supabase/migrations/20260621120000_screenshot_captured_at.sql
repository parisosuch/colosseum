-- Add `captured_at` to the screenshot cache so screenshots can be refreshed
-- lazily once they go stale (see app/api/screenshot/route.ts). It records when
-- the image was last (re)captured; the screenshot route bumps it on every
-- recapture and the client uses it to cache-bust the shared storage object.
--
-- Backfill existing rows from created_at so they aren't all treated as
-- "just captured" (a fresh now() default would reset everyone's TTL clock).
alter table public.screenshot
  add column captured_at timestamptz not null default now();

update public.screenshot set captured_at = created_at;
