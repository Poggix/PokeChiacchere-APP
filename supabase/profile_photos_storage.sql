-- PokeChiacchere: bucket per foto profilo
-- Eseguire una sola volta in Supabase > SQL Editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true, file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Authenticated users can view profile photos" on storage.objects;
create policy "Authenticated users can view profile photos"
on storage.objects for select to authenticated
using (bucket_id = 'profile-photos');

drop policy if exists "Users can upload own profile photos" on storage.objects;
create policy "Users can upload own profile photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update own profile photos" on storage.objects;
create policy "Users can update own profile photos"
on storage.objects for update to authenticated
using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete own profile photos" on storage.objects;
create policy "Users can delete own profile photos"
on storage.objects for delete to authenticated
using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
