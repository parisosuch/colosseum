-- Invite-gated sign-ups.
--
-- Account creation requires a valid invite code. Sign-up is a direct
-- browser -> Supabase Auth call that never passes through our app server, so
-- the ONLY authoritative place to enforce this is a trigger on auth.users. The
-- app passes the code through
--   supabase.auth.signUp({ options: { data: { invite_code } } })
-- which GoTrue persists onto new.raw_user_meta_data, where the trigger reads it.
--
-- Existing members mint codes for the people they want to invite (classic
-- invite tree). Redemption bookkeeping (claiming a use, recording who redeemed)
-- runs in the SECURITY DEFINER trigger, which bypasses RLS, so the policies
-- below only need to cover members reading/creating their own codes.

-- ---------------------------------------------------------------------------
-- invite_code
-- ---------------------------------------------------------------------------
create table public.invite_code (
  code       text primary key,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  max_uses   integer not null default 1 check (max_uses >= 1),
  uses       integer not null default 0 check (uses >= 0 and uses <= max_uses),
  note       text
);

create index invite_code_created_by_idx on public.invite_code (created_by);

-- ---------------------------------------------------------------------------
-- invite_redemption (audit: one row per successful sign-up)
-- ---------------------------------------------------------------------------
create table public.invite_redemption (
  id          bigint generated always as identity primary key,
  code        text not null references public.invite_code (code) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (user_id)
);

create index invite_redemption_code_idx on public.invite_redemption (code);

-- ===========================================================================
-- Enforcement trigger on auth.users
-- ===========================================================================
-- Atomically claims one use of the code and records the redemption. Raising in
-- a BEFORE INSERT trigger aborts the GoTrue transaction, so an invalid or
-- exhausted code prevents the user row (and thus the account) from existing.
create or replace function public.handle_invite_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code     text;
  v_redeemed boolean;
begin
  v_code := nullif(btrim(new.raw_user_meta_data ->> 'invite_code'), '');

  if v_code is null then
    raise exception 'An invite code is required to create an account.'
      using errcode = 'check_violation';
  end if;

  -- The UPDATE row-locks the matched code, serialising concurrent redemptions
  -- so `uses` can never exceed `max_uses`.
  update public.invite_code
     set uses = uses + 1
   where code = v_code
     and uses < max_uses
  returning true into v_redeemed;

  if v_redeemed is not true then
    raise exception 'That invite code is invalid or has already been used.'
      using errcode = 'check_violation';
  end if;

  insert into public.invite_redemption (code, user_id)
    values (v_code, new.id);

  return new;
end;
$$;

create trigger on_auth_user_created_check_invite
  before insert on auth.users
  for each row execute function public.handle_invite_redemption();

-- ===========================================================================
-- Pre-flight validity check (UX only; the trigger above is authoritative)
-- ===========================================================================
-- Lets the (still anonymous) sign-up form tell the user a code is bad before it
-- submits, without exposing the invite_code table to anon reads. SECURITY
-- DEFINER so it can peek past RLS; returns only a boolean.
create or replace function public.invite_code_available(p_code text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.invite_code
    where code = btrim(p_code) and uses < max_uses
  );
$$;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table public.invite_code      enable row level security;
alter table public.invite_redemption enable row level security;

-- Members see and create only their own codes. There is intentionally no
-- update/delete policy: usage counts are mutated solely by the trigger.
create policy "invite_code: read own"
  on public.invite_code for select to authenticated
  using (auth.uid() = created_by);

create policy "invite_code: insert own"
  on public.invite_code for insert to authenticated
  with check (auth.uid() = created_by);

create policy "invite_redemption: read own"
  on public.invite_redemption for select to authenticated
  using (auth.uid() = user_id);

-- ===========================================================================
-- Grants — new tables/functions are not auto-exposed to the Data API roles.
-- Row access stays gated by the RLS policies above; service_role bypasses RLS.
-- ===========================================================================
grant select, insert, update, delete on public.invite_code      to anon, authenticated;
grant select, insert, update, delete on public.invite_redemption to anon, authenticated;
grant all on public.invite_code      to service_role;
grant all on public.invite_redemption to service_role;

grant usage, select on all sequences in schema public to anon, authenticated, service_role;

revoke all on function public.invite_code_available(text) from public;
grant execute on function public.invite_code_available(text) to anon, authenticated;
