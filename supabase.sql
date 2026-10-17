-- =========================================================
-- Ipon — Personal Savings Tracker
-- Supabase schema: tables, relationships, RLS, storage
-- Run this once in the Supabase SQL editor (or via CLI).
-- =========================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------
-- Tables
-- ---------------------------------------------------------

-- Savings platforms (Maya, GoTyme, GCash, BPI, custom, etc.)
create table if not exists public.platforms (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  type        text not null default 'E-Wallet',
  logo_url    text,
  created_at  timestamptz not null default now()
);

-- Deposits / withdrawals against a platform
create table if not exists public.transactions (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform_id  uuid not null references public.platforms(id) on delete cascade,
  type         text not null check (type in ('deposit', 'withdrawal')),
  amount       numeric(12,2) not null check (amount > 0),
  date         date not null default current_date,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_platforms_user       on public.platforms(user_id);
create index if not exists idx_transactions_user     on public.transactions(user_id);
create index if not exists idx_transactions_platform on public.transactions(platform_id);

-- ---------------------------------------------------------
-- Convenience view: live balance per platform
-- security_invoker makes the view respect the RLS policies
-- of the underlying tables (Postgres 15+, used by Supabase).
-- ---------------------------------------------------------
create or replace view public.platform_balances
with (security_invoker = true) as
select
  p.id                                                             as platform_id,
  p.user_id,
  p.name,
  p.type,
  p.logo_url,
  coalesce(sum(case when t.type = 'deposit' then t.amount
                     when t.type = 'withdrawal' then -t.amount
                     else 0 end), 0)                                as balance
from public.platforms p
left join public.transactions t on t.platform_id = p.id
group by p.id;

-- ---------------------------------------------------------
-- Row Level Security — every row is scoped to its owner
-- ---------------------------------------------------------
alter table public.platforms    enable row level security;
alter table public.transactions enable row level security;

create policy "platforms_select_own" on public.platforms
  for select using (auth.uid() = user_id);
create policy "platforms_insert_own" on public.platforms
  for insert with check (auth.uid() = user_id);
create policy "platforms_update_own" on public.platforms
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "platforms_delete_own" on public.platforms
  for delete using (auth.uid() = user_id);

create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);
create policy "transactions_insert_own" on public.transactions
  for insert with check (auth.uid() = user_id);
create policy "transactions_update_own" on public.transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transactions_delete_own" on public.transactions
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- Storage: platform logos
-- Files are stored as  <user_id>/<filename>  so ownership
-- can be checked from the path's first folder segment.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('platform-logos', 'platform-logos', true)
on conflict (id) do nothing;

create policy "logo_public_read" on storage.objects
  for select using (bucket_id = 'platform-logos');

create policy "logo_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'platform-logos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "logo_owner_update" on storage.objects
  for update using (
    bucket_id = 'platform-logos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "logo_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'platform-logos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
