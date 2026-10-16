-- Persistent identity fields for publicly accessible TikTok profiles.
-- Run after 20261016_customer_tiktok_username.sql (or run this file: it is idempotent).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tiktok_username text,
  ADD COLUMN IF NOT EXISTS tiktok_user_id text,
  ADD COLUMN IF NOT EXISTS tiktok_sec_uid text,
  ADD COLUMN IF NOT EXISTS tiktok_avatar_url text,
  ADD COLUMN IF NOT EXISTS tiktok_last_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS customers_tiktok_user_id_idx
  ON public.customers (tiktok_user_id)
  WHERE tiktok_user_id IS NOT NULL AND tiktok_user_id <> '';

CREATE INDEX IF NOT EXISTS customers_tiktok_sec_uid_idx
  ON public.customers (tiktok_sec_uid)
  WHERE tiktok_sec_uid IS NOT NULL AND tiktok_sec_uid <> '';
