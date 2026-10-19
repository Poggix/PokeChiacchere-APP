-- Store verified TikTok customer avatars in a shared public bucket.
-- Objects are keyed by TikTok numeric user ID and are created once; Edge Functions use the service role to upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-tiktok-avatars',
  'customer-tiktok-avatars',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/avif','image/gif']
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = excluded.allowed_mime_types;

-- No client write policies are added: only the Edge Function service role can create these immutable avatar objects.
