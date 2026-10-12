-- PokeChiacchere: profili soci e presenza
-- Eseguire una sola volta in Supabase > SQL Editor.

create table if not exists public.member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  avatar_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.member_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default false
);

alter table public.member_profiles enable row level security;
alter table public.member_presence enable row level security;

grant select, insert, update on public.member_profiles to authenticated;
grant select, insert, update on public.member_presence to authenticated;

drop policy if exists "Authenticated users can read member profiles" on public.member_profiles;
create policy "Authenticated users can read member profiles"
  on public.member_profiles for select to authenticated using (true);

drop policy if exists "Users can insert own member profile" on public.member_profiles;
create policy "Users can insert own member profile"
  on public.member_profiles for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update own member profile" on public.member_profiles;
create policy "Users can update own member profile"
  on public.member_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Authenticated users can read member presence" on public.member_presence;
create policy "Authenticated users can read member presence"
  on public.member_presence for select to authenticated using (true);

drop policy if exists "Users can insert own member presence" on public.member_presence;
create policy "Users can insert own member presence"
  on public.member_presence for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update own member presence" on public.member_presence;
create policy "Users can update own member presence"
  on public.member_presence for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
