create table public.bradymenu_service_recordings_v1 (
  id uuid primary key,
  name text not null default 'Brady' check (name in ('Brady', 'Aria', 'Vivienne')),
  start_time timestamptz not null,
  passage_key_text text not null check (char_length(passage_key_text) between 1 and 120),
  mime_type text not null check (mime_type in ('audio/webm', 'audio/ogg', 'audio/mp4')),
  audio_base64 text not null check (char_length(audio_base64) between 1 and 12000000)
);

alter table public.bradymenu_service_recordings_v1 enable row level security;
grant select, insert, update, delete on public.bradymenu_service_recordings_v1 to anon;

create policy current_recording_only on public.bradymenu_service_recordings_v1
  for all to anon
  using (id::text = (current_setting('request.headers', true)::jsonb ->> 'x-recording-id'))
  with check (id::text = (current_setting('request.headers', true)::jsonb ->> 'x-recording-id'));
