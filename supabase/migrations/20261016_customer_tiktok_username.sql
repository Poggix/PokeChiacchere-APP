-- Add a persistent TikTok username to each customer record.
-- Run this migration in Supabase SQL Editor before installing the updated app.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tiktok_username text;

CREATE INDEX IF NOT EXISTS customers_tiktok_username_idx
  ON public.customers (lower(tiktok_username))
  WHERE tiktok_username IS NOT NULL AND tiktok_username <> '';
