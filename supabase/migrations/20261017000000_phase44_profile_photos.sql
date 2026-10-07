-- Phase 44: Private Profile Photos Storage Bucket
-- Creates a dedicated private storage bucket for mentor profile photos
-- with secure authenticated ownership policies.

-- Create the private bucket for profile photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do nothing;

-- Owners can upload their own profile photo
-- Path format: profile-photos/{authenticated-user-id}/{unique-file-name}
create policy "Users can upload own profile photo"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
  and (storage.extension(name) = any (array['jpg','jpeg','png','webp']))
);

-- Owners can update their profile photo
create policy "Users can update own profile photo"
on storage.objects for update
to authenticated
using (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- Owners can delete their profile photo
create policy "Users can delete own profile photo"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- Authenticated users can view profile photos (for mentor discovery)
-- This allows seekers to see mentor avatars while keeping the bucket private
create policy "Authenticated users can view profile photos"
on storage.objects for select
to authenticated
using (bucket_id = 'profile-photos');

-- Admins have full access to profile photos
create policy "Admins have full access to profile photos"
on storage.objects for all
to authenticated
using (
  bucket_id = 'profile-photos'
  and public.is_admin()
)
with check (
  bucket_id = 'profile-photos'
  and public.is_admin()
);