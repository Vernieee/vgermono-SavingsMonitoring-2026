-- =========================================================
-- Ipon — Savings Goals
-- Run this once in the Supabase SQL editor, AFTER supabase.sql.
-- Safe to re-run: every statement is idempotent.
--
-- Goals are an allocation layer on top of your platform
-- balances: adding money to a goal does NOT change any
-- platform balance or create a transaction.
-- =========================================================

-- ---------------------------------------------------------
-- Tables
-- ---------------------------------------------------------
create table if not exists public.goals (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null check (char_length(btrim(name)) > 0),
  description    text,
  target_amount  numeric(12,2) not null check (target_amount > 0),
  target_date    date,
  status         text not null default 'active' check (status in ('active', 'completed')),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.goal_contributions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  goal_id     uuid not null references public.goals(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  date        date not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_goals_user                    on public.goals(user_id);
create index if not exists idx_goal_contributions_user       on public.goal_contributions(user_id);
create index if not exists idx_goal_contributions_goal       on public.goal_contributions(goal_id);

-- ---------------------------------------------------------
-- View: each goal with the total contributed so far.
-- security_invoker makes it respect the RLS policies below.
-- ---------------------------------------------------------
create or replace view public.goal_progress
with (security_invoker = true) as
select
  g.id            as goal_id,
  g.user_id,
  g.name,
  g.description,
  g.target_amount,
  g.target_date,
  g.status,
  g.completed_at,
  g.created_at,
  coalesce(sum(c.amount), 0) as saved
from public.goals g
left join public.goal_contributions c on c.goal_id = g.id
group by g.id;

-- ---------------------------------------------------------
-- Row Level Security — every row is scoped to its owner
-- ---------------------------------------------------------
alter table public.goals              enable row level security;
alter table public.goal_contributions enable row level security;

drop policy if exists "goals_select_own" on public.goals;
drop policy if exists "goals_insert_own" on public.goals;
drop policy if exists "goals_update_own" on public.goals;
drop policy if exists "goals_delete_own" on public.goals;

create policy "goals_select_own" on public.goals
  for select using (auth.uid() = user_id);
create policy "goals_insert_own" on public.goals
  for insert with check (auth.uid() = user_id);
create policy "goals_update_own" on public.goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goals_delete_own" on public.goals
  for delete using (auth.uid() = user_id);

drop policy if exists "goal_contributions_select_own" on public.goal_contributions;
drop policy if exists "goal_contributions_insert_own" on public.goal_contributions;
drop policy if exists "goal_contributions_update_own" on public.goal_contributions;
drop policy if exists "goal_contributions_delete_own" on public.goal_contributions;

create policy "goal_contributions_select_own" on public.goal_contributions
  for select using (auth.uid() = user_id);
-- A contribution must belong to the user AND point at one of the user's own goals.
create policy "goal_contributions_insert_own" on public.goal_contributions
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid())
  );
create policy "goal_contributions_update_own" on public.goal_contributions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goal_contributions_delete_own" on public.goal_contributions
  for delete using (auth.uid() = user_id);
