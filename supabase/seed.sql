-- Seed data for local development (loaded by `supabase db reset`).
--
-- Creates one confirmed test user and some sample channels/columns so the app
-- has something to render. Email confirmations are disabled locally
-- (auth.email.enable_confirmations = false in config.toml), so you can log in
-- immediately with the credentials below.
--
--   email:    test@example.com
--   password: password123

-- --- test user -------------------------------------------------------------
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'test@example.com',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '', '', '', ''
)
on conflict (id) do nothing;

-- email identity (required by GoTrue for email/password sign-in)
insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '{"sub":"00000000-0000-0000-0000-000000000001","email":"test@example.com","email_verified":true}',
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do nothing;

-- --- profile ---------------------------------------------------------------
insert into public.user_profile (user_id, handle, about) values (
  '00000000-0000-0000-0000-000000000001',
  'demo',
  'Local dev test account'
)
on conflict (user_id) do nothing;

-- --- channels + columns ----------------------------------------------------
with public_channel as (
  insert into public.channel (title, description, private, owner_id)
  values (
    'Design Inspiration',
    'A public board of references and links',
    false,
    '00000000-0000-0000-0000-000000000001'
  )
  returning id
),
private_channel as (
  insert into public.channel (title, description, private, owner_id)
  values (
    'Private Notes',
    'A private scratchpad',
    true,
    '00000000-0000-0000-0000-000000000001'
  )
  returning id
)
insert into public."column" (type, url, text, title, created_by, channel_id)
select 'url', 'https://supabase.com', null, 'Supabase',
       '00000000-0000-0000-0000-000000000001'::uuid, public_channel.id
from public_channel
union all
select 'text', null, 'Welcome to Colosseum 👋', null,
       '00000000-0000-0000-0000-000000000001'::uuid, public_channel.id
from public_channel
union all
select 'url', 'https://nextjs.org', null, 'Next.js',
       '00000000-0000-0000-0000-000000000001'::uuid, private_channel.id
from private_channel;
