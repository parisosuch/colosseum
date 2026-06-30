-- RLS for the avatars storage bucket.
-- Each user's avatar is stored at avatars/{user_id} (no extension).
-- The bucket is public (config.toml), so reads via the public URL need no policy.
-- These policies gate authenticated API access.

create policy "avatars: public read"
  on storage.objects for select
  using ( bucket_id = 'avatars' );

create policy "avatars: insert own"
  on storage.objects for insert
  with check ( bucket_id = 'avatars' and name = auth.uid()::text );

create policy "avatars: update own"
  on storage.objects for update
  using ( bucket_id = 'avatars' and name = auth.uid()::text );

create policy "avatars: delete own"
  on storage.objects for delete
  using ( bucket_id = 'avatars' and name = auth.uid()::text );
