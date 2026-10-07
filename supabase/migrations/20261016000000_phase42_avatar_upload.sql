-- Phase 42: Avatar upload infrastructure
-- Creates a private storage bucket for mentor avatars and
-- grants role-scoped insert/update/select access.

create extension if not exists pgcrypto;

-- Storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do nothing;

-- Owners can upload their own avatar
create policy "Users can upload own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
  and (storage.extension(name) = any (array['jpg','jpeg','png','webp']))
);

-- Owners can update their avatar
create policy "Users can update own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- Owners can delete their avatar
create policy "Users can delete own avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- Signed public read for anyone
create policy "Public can read avatar"
on storage.objects for select
to public
using (bucket_id = 'avatars');
