-- Staff and cashier checkout support.
-- Run this once in the Supabase SQL editor for existing Glide databases.

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'cashier' check (role in ('cashier')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, email)
);

alter table public.orders
add column if not exists staff_member_id uuid references public.staff_members(id) on delete set null;

create index if not exists staff_members_user_id_idx on public.staff_members(user_id);
create index if not exists staff_members_merchant_id_idx on public.staff_members(merchant_id);

create or replace function public.is_active_staff(target_merchant_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_members
    where merchant_id = target_merchant_id
    and user_id = auth.uid()
    and is_active
  );
$$;

drop trigger if exists staff_members_touch_updated_at on public.staff_members;
create trigger staff_members_touch_updated_at
before update on public.staff_members
for each row execute function public.touch_updated_at();

alter table public.staff_members enable row level security;

drop policy if exists "merchant manages own staff" on public.staff_members;
create policy "merchant manages own staff"
on public.staff_members for all
to authenticated
using (public.owns_merchant(merchant_id))
with check (public.owns_merchant(merchant_id));

drop policy if exists "staff reads own staff row" on public.staff_members;
create policy "staff reads own staff row"
on public.staff_members for select
to authenticated
using (user_id = auth.uid() and is_active);

drop policy if exists "staff reads merchant products" on public.products;
create policy "staff reads merchant products"
on public.products for select
to authenticated
using (public.is_active_staff(merchant_id));
