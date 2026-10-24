-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It creates the table that stores each user's scan history and locks it so
-- every user can only see and change their own rows (row-level security).

create table if not exists public.scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email_text  text not null check (char_length(email_text) <= 8000),
  label       text not null check (label in ('phishing', 'safe', 'unsure')),
  probability real not null check (probability >= 0 and probability <= 1),
  top_words   jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists scans_user_created_idx on public.scans (user_id, created_at desc);

alter table public.scans enable row level security;

drop policy if exists "scans_select_own" on public.scans;
drop policy if exists "scans_insert_own" on public.scans;
drop policy if exists "scans_delete_own" on public.scans;

create policy "scans_select_own" on public.scans
  for select to authenticated using (auth.uid() = user_id);

create policy "scans_insert_own" on public.scans
  for insert to authenticated with check (auth.uid() = user_id);

create policy "scans_delete_own" on public.scans
  for delete to authenticated using (auth.uid() = user_id);
