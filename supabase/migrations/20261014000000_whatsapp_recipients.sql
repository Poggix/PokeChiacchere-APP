-- Rubrica destinatari WhatsApp PokeChiacchere.
-- Gli accessi dell'app passano esclusivamente dalla Edge Function autenticata.
create table if not exists public.whatsapp_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_e164 text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists whatsapp_recipients_phone_e164_uidx
  on public.whatsapp_recipients (phone_e164);

alter table public.whatsapp_recipients enable row level security;
revoke all on table public.whatsapp_recipients from anon, authenticated;
