-- Row Level Security for the `blocks` storage bucket (image blocks).
--
-- The bucket itself is declared in supabase/config.toml. Objects are stored
-- under a per-user prefix — `{user_id}/{channel_id}/{uuid}.{ext}` — so writes
-- can be gated to the uploader's own folder while reads stay public (the bucket
-- is public, matching column.image being a plain getPublicUrl link).

-- Public read for image blocks.
create policy "blocks: public read"
  on storage.objects for select
  using (bucket_id = 'blocks');

-- Writes limited to the caller's own top-level folder (folder name = user id).
create policy "blocks: insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'blocks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "blocks: update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'blocks'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'blocks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "blocks: delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'blocks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
