-- PokeChiacchere: foto nell'archivio prodotti
-- Eseguire una sola volta nel Supabase SQL Editor.

alter table public.products
  add column if not exists photo_url text;

insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Product photos are publicly readable" on storage.objects;
create policy "Product photos are publicly readable"
on storage.objects for select
using (bucket_id = 'product-photos');

drop policy if exists "Authenticated users can upload product photos" on storage.objects;
create policy "Authenticated users can upload product photos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'product-photos');

drop policy if exists "Authenticated users can update product photos" on storage.objects;
create policy "Authenticated users can update product photos"
on storage.objects for update
to authenticated
using (bucket_id = 'product-photos')
with check (bucket_id = 'product-photos');

drop policy if exists "Authenticated users can delete product photos" on storage.objects;
create policy "Authenticated users can delete product photos"
on storage.objects for delete
to authenticated
using (bucket_id = 'product-photos');
