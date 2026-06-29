-- Connections: let a block ("column") live in multiple channels.
--
-- Replaces the single `column.channel_id` FK with a `block_channel` join table
-- (are.na-style connections). A block is owned by its creator (column.created_by)
-- and appears in every channel it is connected to. Single-user scope: you may
-- connect a block to a channel only when you own both.

-- ---------------------------------------------------------------------------
-- block_channel (membership: a block <-> a channel it appears in)
-- ---------------------------------------------------------------------------
create table public.block_channel (
  block_id   bigint not null references public."column" (id) on delete cascade,
  channel_id bigint not null references public.channel (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (block_id, channel_id)
);

create index block_channel_channel_id_idx on public.block_channel (channel_id);

-- Backfill one membership row per existing block from its current channel,
-- preserving the original timestamp so channel ordering is unchanged.
insert into public.block_channel (block_id, channel_id, created_at)
  select id, channel_id, created_at from public."column";

-- ---------------------------------------------------------------------------
-- Drop the single-channel FK. The two RLS policies that reference channel_id
-- must be dropped first (a column can't be dropped while a policy depends on
-- it); they are recreated below against block_channel.
-- ---------------------------------------------------------------------------
drop policy "column: read via channel visibility" on public."column";
drop policy "column: insert into own channel" on public."column";

alter table public."column" drop column channel_id;

-- ---------------------------------------------------------------------------
-- column RLS, re-expressed in terms of block_channel
-- ---------------------------------------------------------------------------
-- Readable when the creator is the requester (so a block with no connections is
-- still visible to its owner) or it is connected to any channel the requester
-- can see.
create policy "column: read via connections"
  on public."column" for select
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.block_channel bc
      join public.channel c on c.id = bc.channel_id
      where bc.block_id = "column".id
        and (c.private = false or c.owner_id = auth.uid())
    )
  );

-- A block is created by its owner; the channel link is gated separately by the
-- block_channel insert policy.
create policy "column: insert own"
  on public."column" for insert to authenticated
  with check (auth.uid() = created_by);

-- ---------------------------------------------------------------------------
-- block_channel RLS
-- ---------------------------------------------------------------------------
alter table public.block_channel enable row level security;

-- Visible when you can see the channel side of the connection (public or yours).
create policy "block_channel: read via channel visibility"
  on public.block_channel for select
  using (
    exists (
      select 1 from public.channel c
      where c.id = block_channel.channel_id
        and (c.private = false or c.owner_id = auth.uid())
    )
  );

-- Connect: you must own both the channel and the block (single-user scope).
create policy "block_channel: connect own"
  on public.block_channel for insert to authenticated
  with check (
    exists (select 1 from public.channel c where c.id = block_channel.channel_id and c.owner_id = auth.uid())
    and exists (select 1 from public."column" b where b.id = block_channel.block_id and b.created_by = auth.uid())
  );

-- Disconnect: you may remove a block from a channel you own.
create policy "block_channel: disconnect own"
  on public.block_channel for delete to authenticated
  using (
    exists (select 1 from public.channel c where c.id = block_channel.channel_id and c.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Atomic block creation: insert the block and its first channel connection in
-- one transaction. SECURITY INVOKER so the RLS policies above still apply.
-- ---------------------------------------------------------------------------
create or replace function public.create_block(
  p_type       text,
  p_channel_id bigint,
  p_url        text default null,
  p_text       text default null,
  p_image      text default null
)
returns public."column"
language plpgsql
security invoker
as $$
declare
  v_block public."column";
begin
  insert into public."column" (type, url, text, image, created_by)
    values (p_type, p_url, p_text, p_image, auth.uid())
    returning * into v_block;

  insert into public.block_channel (block_id, channel_id)
    values (v_block.id, p_channel_id);

  return v_block;
end;
$$;

-- ---------------------------------------------------------------------------
-- A channel's blocks, ordered by when each was connected (newest first).
-- SECURITY INVOKER so the column / block_channel RLS policies still filter the
-- result. Encapsulates the join so callers don't depend on PostgREST embedding.
-- ---------------------------------------------------------------------------
create or replace function public.get_channel_blocks(p_channel_id bigint)
returns setof public."column"
language sql
security invoker
stable
as $$
  select c.*
  from public."column" c
  join public.block_channel bc on bc.block_id = c.id
  where bc.channel_id = p_channel_id
  order by bc.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Grants (new table/functions are not auto-exposed to the Data API roles).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.block_channel to anon, authenticated;
grant all on public.block_channel to service_role;

revoke all on function public.create_block(text, bigint, text, text, text) from public;
grant execute on function public.create_block(text, bigint, text, text, text) to authenticated;

revoke all on function public.get_channel_blocks(bigint) from public;
grant execute on function public.get_channel_blocks(bigint) to anon, authenticated;
