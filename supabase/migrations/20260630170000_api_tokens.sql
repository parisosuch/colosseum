-- Personal API tokens for the REST API (app/api/v1/*).
--
-- A token is a bearer secret an external client sends as `Authorization: Bearer
-- <token>`. It is NOT a Supabase session, so RLS (which authorizes via
-- auth.uid()) can't gate API requests: the route handlers resolve a token to a
-- user_id with the service_role key and then enforce ownership explicitly. See
-- lib/colosseum/api-auth.ts. This mirrors app/api/screenshot/route.ts, which
-- already trusts service_role behind a bearer-token check.
--
-- Only the SHA-256 hash of the token is stored. The plaintext is shown to the
-- user exactly once at creation and is unrecoverable afterwards, so a database
-- leak doesn't expose usable tokens. `token_prefix` is a non-secret slice kept
-- for display ("clsm_a1b2c3d4…") so a user can tell their tokens apart.

create table public.api_token (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text,
  token_prefix text not null,
  token_hash   text not null unique,
  last_used_at timestamptz
);

create index api_token_user_id_idx on public.api_token (user_id);

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table public.api_token enable row level security;

-- A member manages only their own tokens. There is intentionally no update
-- policy (a token's secret is immutable; last_used_at is bumped by the API via
-- service_role, which bypasses RLS). Note token_hash is readable by the owner
-- under these policies, so the settings UI must select only non-secret columns.
create policy "api_token: read own"
  on public.api_token for select to authenticated
  using (auth.uid() = user_id);

create policy "api_token: insert own"
  on public.api_token for insert to authenticated
  with check (auth.uid() = user_id);

create policy "api_token: delete own"
  on public.api_token for delete to authenticated
  using (auth.uid() = user_id);

-- ===========================================================================
-- Grants — new tables are not auto-exposed to the Data API roles. Row access
-- stays gated by the RLS policies above; service_role bypasses RLS.
-- ===========================================================================
grant select, insert, delete on public.api_token to anon, authenticated;
grant all on public.api_token to service_role;
