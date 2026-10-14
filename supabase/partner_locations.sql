-- PokeChiacchere - condivisione posizione socio
-- Eseguire questo script nell'SQL Editor del progetto Supabase.
create table if not exists public.partner_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  updated_at timestamptz not null default now()
);

alter table public.partner_locations enable row level security;

drop policy if exists "Owner can read partner location" on public.partner_locations;
drop policy if exists "Non-owner can publish own location" on public.partner_locations;
drop policy if exists "Non-owner can update own location" on public.partner_locations;
drop policy if exists "Owner and partner can read permitted locations" on public.partner_locations;
drop policy if exists "Authenticated user can publish own location" on public.partner_locations;
drop policy if exists "Authenticated user can update own location" on public.partner_locations;

-- L'owner può leggere tutte le posizioni; il socio solo la propria.
create policy "Owner and partner can read permitted locations"
on public.partner_locations
for select to authenticated
using (
  auth.uid() = '01bf546e-bf28-46ac-8370-b4fe30d8a8fd'::uuid
  or auth.uid() = user_id
);

-- Ogni account autenticato può inserire esclusivamente la propria posizione.
create policy "Authenticated user can publish own location"
on public.partner_locations
for insert to authenticated
with check (auth.uid() = user_id);

-- Consente anche l'upsert successivo della posizione già esistente.
create policy "Authenticated user can update own location"
on public.partner_locations
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.partner_locations to authenticated;
