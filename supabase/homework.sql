create table public.viviennemenu_homework_documents (
  document_key text primary key check (document_key = 'homework'),
  content_html text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.viviennemenu_homework_documents enable row level security;
grant select, insert, update on public.viviennemenu_homework_documents to anon, authenticated;
create policy homework_read on public.viviennemenu_homework_documents
  for select to anon, authenticated using (document_key = 'homework');
create policy homework_insert on public.viviennemenu_homework_documents
  for insert to anon, authenticated with check (document_key = 'homework');
create policy homework_update on public.viviennemenu_homework_documents
  for update to anon, authenticated using (document_key = 'homework') with check (document_key = 'homework');
insert into public.viviennemenu_homework_documents (document_key, content_html)
values ('homework', coalesce((select content_html from public.bradymenu_homework_documents where document_key = 'homework'), ''));
