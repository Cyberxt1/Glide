-- Glide three-store pilot operations: verification, shifts, timelines and store controls.
alter table public.merchant_profile
  add column if not exists verification_mode text not null default 'all',
  add column if not exists verification_threshold numeric(12,2) not null default 0,
  add column if not exists random_audit_percent integer not null default 0,
  add column if not exists mismatch_tolerance integer not null default 0,
  add column if not exists vat_percent numeric(5,2) not null default 0,
  add column if not exists receipt_footer text,
  add column if not exists operating_hours jsonb not null default '{}'::jsonb;

alter table public.merchant_profile drop constraint if exists merchant_profile_verification_mode_check;
alter table public.merchant_profile add constraint merchant_profile_verification_mode_check
  check (verification_mode in ('all', 'threshold_random'));
alter table public.merchant_profile drop constraint if exists merchant_profile_random_audit_check;
alter table public.merchant_profile add constraint merchant_profile_random_audit_check
  check (random_audit_percent between 0 and 100);

alter table public.products
  add column if not exists entry_mode text not null default 'barcode',
  add column if not exists is_restricted boolean not null default false,
  add column if not exists requires_quantity_entry boolean not null default false;

alter table public.products drop constraint if exists products_entry_mode_check;
alter table public.products add constraint products_entry_mode_check
  check (entry_mode in ('barcode', 'plu', 'weighed'));

alter table public.orders
  add column if not exists verification_outcome text,
  add column if not exists checkout_duration_seconds integer,
  add column if not exists verification_started_at timestamptz,
  add column if not exists verified_by_staff_id uuid references public.staff_members(id) on delete set null;

alter table public.orders drop constraint if exists orders_verification_outcome_check;
alter table public.orders add constraint orders_verification_outcome_check
  check (verification_outcome is null or verification_outcome in ('matched', 'mismatch'));

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete set null,
  event_type text not null,
  event_label text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_created_idx on public.order_events(order_id, created_at);
create index if not exists order_events_merchant_created_idx on public.order_events(merchant_id, created_at desc);

create table if not exists public.verification_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete set null,
  outcome text not null check (outcome in ('matched', 'mismatch')),
  reason_codes text[] not null default '{}',
  checked_items jsonb not null default '[]'::jsonb,
  incident_note text,
  balance_collected numeric(12,2) not null default 0,
  balance_payment_method text,
  created_at timestamptz not null default now()
);

create index if not exists verification_records_merchant_created_idx on public.verification_records(merchant_id, created_at desc);

create table if not exists public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  station text not null default 'security',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  baskets_verified integer not null default 0,
  mismatches integer not null default 0,
  assisted_sales integer not null default 0,
  cash_collected numeric(12,2) not null default 0
);

create unique index if not exists cashier_shifts_one_open_per_user
  on public.cashier_shifts(user_id, station) where ended_at is null;

alter table public.order_events enable row level security;
alter table public.verification_records enable row level security;
alter table public.cashier_shifts enable row level security;

drop policy if exists "merchant reads own order events" on public.order_events;
create policy "merchant reads own order events" on public.order_events for select to authenticated
using (public.owns_merchant(merchant_id));
drop policy if exists "merchant reads own verification records" on public.verification_records;
create policy "merchant reads own verification records" on public.verification_records for select to authenticated
using (public.owns_merchant(merchant_id));
drop policy if exists "merchant reads own shifts" on public.cashier_shifts;
create policy "merchant reads own shifts" on public.cashier_shifts for select to authenticated
using (public.owns_merchant(merchant_id));
