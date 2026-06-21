-- Colosseum schema (reconstructed from the data-access layer in lib/colosseum/*
-- and app/api/screenshot/route.ts). See README "Local development" for context.
--
-- Tables: user_profile, channel, "column", screenshot
-- Storage buckets are declared in supabase/config.toml ([storage.buckets.*]).
--
-- NOTE: "column" is a reserved SQL keyword, so the table name is always quoted.
--
-- ASSUMPTIONS (reconstructed, not pulled from a live DB) — confirm against prod:
--   * `channel.id` and `"column".id` are bigint identity columns (code never
--     supplies an id and reads them back as numbers).
--   * Foreign keys cascade on delete.
--   * RLS: profiles are world-readable; channels/columns are readable when the
--     parent channel is public OR owned by the requester; writes are limited to
--     the owner. Both the browser and server clients use the anon key with the
--     user's session, so these policies apply on every path. The only
--     service_role user is app/api/screenshot/route.ts (trusted screenshot
--     cache writer, gated by a bearer-token auth check).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- user_profile
-- ---------------------------------------------------------------------------
create table public.user_profile (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  handle     text not null unique,
  avatar_url text,
  about      text
);

-- ---------------------------------------------------------------------------
-- channel
-- ---------------------------------------------------------------------------
create table public.channel (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  title       text not null,
  description text,
  private     boolean not null default false,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  updated_at  timestamptz
);

create index channel_owner_id_idx on public.channel (owner_id);

-- ---------------------------------------------------------------------------
-- "column"
-- ---------------------------------------------------------------------------
create table public."column" (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  type        text not null check (type in ('url', 'text', 'image')),
  title       text,
  description text,
  url         text,
  text        text,
  image       text,
  created_by  uuid not null references auth.users (id) on delete cascade,
  channel_id  bigint not null references public.channel (id) on delete cascade
);

create index column_channel_id_idx on public."column" (channel_id);

-- ---------------------------------------------------------------------------
-- screenshot (URL screenshot cache, written by app/api/screenshot/route.ts)
-- ---------------------------------------------------------------------------
create table public.screenshot (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  url        text not null unique,
  image_url  text,
  title      text
);

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table public.user_profile enable row level security;
alter table public.channel      enable row level security;
alter table public."column"     enable row level security;
alter table public.screenshot   enable row level security;

-- user_profile: public read, self-managed write -----------------------------
create policy "user_profile: public read"
  on public.user_profile for select
  using (true);

create policy "user_profile: insert own"
  on public.user_profile for insert to authenticated
  with check (auth.uid() = user_id);

create policy "user_profile: update own"
  on public.user_profile for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- channel: readable when public or owned; owner-only writes ------------------
create policy "channel: read public or own"
  on public.channel for select
  using (private = false or auth.uid() = owner_id);

create policy "channel: insert own"
  on public.channel for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "channel: update own"
  on public.channel for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "channel: delete own"
  on public.channel for delete to authenticated
  using (auth.uid() = owner_id);

-- "column": follows parent channel visibility; creator-only writes -----------
create policy "column: read via channel visibility"
  on public."column" for select
  using (
    exists (
      select 1 from public.channel c
      where c.id = "column".channel_id
        and (c.private = false or c.owner_id = auth.uid())
    )
  );

create policy "column: insert into own channel"
  on public."column" for insert to authenticated
  with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.channel c
      where c.id = "column".channel_id and c.owner_id = auth.uid()
    )
  );

create policy "column: update own"
  on public."column" for update to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

create policy "column: delete own"
  on public."column" for delete to authenticated
  using (auth.uid() = created_by);

-- screenshot: public read; writes happen via service_role (screenshot route) -
create policy "screenshot: public read"
  on public.screenshot for select
  using (true);

-- ===========================================================================
-- Grants — required because new public tables are not auto-exposed to the
-- Data API roles by default (see auto_expose_new_tables in config.toml).
-- Row access is still gated by the RLS policies above; service_role bypasses RLS.
-- ===========================================================================
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public to anon, authenticated;
grant all
  on all tables in schema public to service_role;

grant usage, select
  on all sequences in schema public to anon, authenticated, service_role;
