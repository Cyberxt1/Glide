create extension if not exists pgcrypto;

create table if not exists public.merchant_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  store_name text not null default 'Glide Store',
  branch_name text not null default 'Main branch',
  terminal_auth_code text default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  geofence_latitude double precision,
  geofence_longitude double precision,
  geofence_radius_meters integer not null default 150 check (geofence_radius_meters between 25 and 5000),
  geofence_enabled boolean not null default false,
  onboarding_status text not null default 'approved' check (onboarding_status in ('draft', 'pending', 'approved', 'rejected', 'suspended')),
  onboarding_submitted_at timestamptz,
  onboarding_reviewed_at timestamptz,
  onboarding_review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.merchant_profile add column if not exists geofence_latitude double precision;
alter table public.merchant_profile add column if not exists geofence_longitude double precision;
alter table public.merchant_profile add column if not exists geofence_radius_meters integer not null default 150;
alter table public.merchant_profile add column if not exists geofence_enabled boolean not null default false;
alter table public.merchant_profile add column if not exists onboarding_status text not null default 'approved';
alter table public.merchant_profile add column if not exists onboarding_submitted_at timestamptz;
alter table public.merchant_profile add column if not exists onboarding_reviewed_at timestamptz;
alter table public.merchant_profile add column if not exists onboarding_review_note text;

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'cashier' check (role in ('cashier', 'security')),
  is_active boolean not null default true,
  terminal_auth_code text default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  last_seen_at timestamptz,
  current_station text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, email)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  name text not null,
  barcode text not null,
  sku text,
  category text,
  price numeric(12,2) not null check (price >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  unit_label text not null default 'piece',
  pack_label text,
  units_per_pack integer not null default 1 check (units_per_pack >= 1),
  pack_price numeric(12,2) check (pack_price is null or pack_price >= 0),
  is_available boolean not null default true,
  track_inventory boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, barcode),
  unique (merchant_id, sku)
);

create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  qr_code text not null unique,
  is_active boolean not null default true,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete set null,
  qr_code_id uuid references public.qr_codes(id),
  order_number text not null unique,
  shopper_session_id text,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'exited', 'cancelled')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed')),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  spend_limit numeric(12,2),
  challenge_target numeric(12,2) not null default 15000,
  challenge_qualified boolean not null default false,
  receipt_token text not null unique,
  exit_token text not null unique,
  paid_at timestamptz,
  exited_at timestamptz,
  receipt_delivery_status text not null default 'not_requested' check (receipt_delivery_status in ('not_requested', 'pending', 'sent', 'failed')),
  receipt_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders
add column if not exists shopper_session_id text;

alter table public.orders
add column if not exists staff_member_id uuid references public.staff_members(id) on delete set null;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  barcode text,
  quantity integer not null check (quantity > 0),
  sale_unit text not null default 'piece',
  unit_quantity integer not null default 1 check (unit_quantity >= 1),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'paystack',
  provider_reference text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  amount numeric(12,2) not null check (amount >= 0),
  provider_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  movement_type text not null check (movement_type in ('import', 'manual_adjustment', 'sale')),
  quantity_delta integer not null,
  created_at timestamptz not null default now()
);

create index if not exists products_barcode_idx on public.products(barcode);
create index if not exists products_sku_idx on public.products(sku);
create index if not exists staff_members_user_id_idx on public.staff_members(user_id);
create index if not exists staff_members_merchant_id_idx on public.staff_members(merchant_id);
create index if not exists staff_members_last_seen_at_idx on public.staff_members(last_seen_at);
create index if not exists qr_codes_qr_code_idx on public.qr_codes(qr_code);
create index if not exists orders_receipt_token_idx on public.orders(receipt_token);
create index if not exists orders_shopper_session_id_idx on public.orders(shopper_session_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_payment_status_idx on public.orders(payment_status);
create index if not exists orders_pending_timeout_idx
  on public.orders(merchant_id, created_at)
  where status = 'pending_payment' and payment_status = 'pending';
create unique index if not exists one_active_qr_per_merchant_idx
  on public.qr_codes(merchant_id)
  where is_active;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_merchant_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from public.merchant_profile where user_id = auth.uid() limit 1;
$$;

create or replace function public.owns_merchant(target_merchant_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.merchant_profile
    where id = target_merchant_id and user_id = auth.uid()
  );
$$;

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

create or replace function public.cancel_expired_pending_orders(target_merchant_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer;
begin
  update public.orders
  set
    status = 'cancelled',
    payment_status = 'failed',
    updated_at = now()
  where status = 'pending_payment'
    and payment_status = 'pending'
    and created_at <= now() - interval '1 hour'
    and (target_merchant_id is null or merchant_id = target_merchant_id);

  get diagnostics affected_count = row_count;

  update public.payments
  set
    status = 'failed',
    provider_payload = coalesce(provider_payload, '{}'::jsonb)
      || jsonb_build_object('cancelled_reason', 'pending_payment_timeout')
  where status = 'pending'
    and exists (
      select 1
      from public.orders
      where orders.id = payments.order_id
        and orders.status = 'cancelled'
        and orders.payment_status = 'failed'
        and (target_merchant_id is null or orders.merchant_id = target_merchant_id)
    );

  return affected_count;
end;
$$;

create or replace function public.set_current_merchant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.merchant_id is null then
    new.merchant_id := public.current_merchant_id();
  end if;
  return new;
end;
$$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
before update on public.orders
for each row execute function public.touch_updated_at();

drop trigger if exists merchant_profile_touch_updated_at on public.merchant_profile;
create trigger merchant_profile_touch_updated_at
before update on public.merchant_profile
for each row execute function public.touch_updated_at();

drop trigger if exists staff_members_touch_updated_at on public.staff_members;
create trigger staff_members_touch_updated_at
before update on public.staff_members
for each row execute function public.touch_updated_at();

drop trigger if exists products_set_current_merchant on public.products;
create trigger products_set_current_merchant
before insert on public.products
for each row execute function public.set_current_merchant();

drop trigger if exists qr_codes_set_current_merchant on public.qr_codes;
create trigger qr_codes_set_current_merchant
before insert on public.qr_codes
for each row execute function public.set_current_merchant();

alter table public.merchant_profile enable row level security;
alter table public.staff_members enable row level security;
alter table public.products enable row level security;
alter table public.qr_codes enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists "merchant reads own profile" on public.merchant_profile;
create policy "merchant reads own profile"
on public.merchant_profile for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "public reads store display profile" on public.merchant_profile;
create policy "public reads store display profile"
on public.merchant_profile for select
to anon, authenticated
using (
  exists (
    select 1 from public.qr_codes
    where qr_codes.merchant_id = merchant_profile.id
    and qr_codes.is_active
  )
);

drop policy if exists "merchant creates own profile" on public.merchant_profile;
create policy "merchant creates own profile"
on public.merchant_profile for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "merchant updates own profile" on public.merchant_profile;
create policy "merchant updates own profile"
on public.merchant_profile for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

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

drop policy if exists "merchant manages own products" on public.products;
create policy "merchant manages own products"
on public.products for all
to authenticated
using (public.owns_merchant(merchant_id))
with check (public.owns_merchant(merchant_id));

drop policy if exists "staff reads merchant products" on public.products;
create policy "staff reads merchant products"
on public.products for select
to authenticated
using (public.is_active_staff(merchant_id));

drop policy if exists "public reads checkout products" on public.products;
create policy "public reads checkout products"
on public.products for select
to anon, authenticated
using (
  is_available
  and exists (
    select 1 from public.qr_codes
    where qr_codes.merchant_id = products.merchant_id
    and qr_codes.is_active
  )
);

drop policy if exists "merchant manages own qr codes" on public.qr_codes;
create policy "merchant manages own qr codes"
on public.qr_codes for all
to authenticated
using (public.owns_merchant(merchant_id))
with check (public.owns_merchant(merchant_id));

drop policy if exists "public reads qr codes" on public.qr_codes;
create policy "public reads qr codes"
on public.qr_codes for select
to anon, authenticated
using (true);

drop policy if exists "merchant reads own orders" on public.orders;
create policy "merchant reads own orders"
on public.orders for select
to authenticated
using (public.owns_merchant(merchant_id));

drop policy if exists "merchant verifies own paid orders" on public.orders;
create policy "merchant verifies own paid orders"
on public.orders for update
to authenticated
using (public.owns_merchant(merchant_id))
with check (public.owns_merchant(merchant_id));

drop policy if exists "public reads paid receipts" on public.orders;
create policy "public reads paid receipts"
on public.orders for select
to anon, authenticated
using (receipt_token is not null and status in ('paid', 'exited'));

drop policy if exists "merchant reads own order items" on public.order_items;
create policy "merchant reads own order items"
on public.order_items for select
to authenticated
using (
  exists (
    select 1 from public.orders
    where orders.id = order_items.order_id
    and public.owns_merchant(orders.merchant_id)
  )
);

drop policy if exists "public reads paid receipt items" on public.order_items;
create policy "public reads paid receipt items"
on public.order_items for select
to anon, authenticated
using (
  exists (
    select 1 from public.orders
    where orders.id = order_items.order_id
    and orders.status in ('paid', 'exited')
  )
);

drop policy if exists "merchant reads own payments" on public.payments;
create policy "merchant reads own payments"
on public.payments for select
to authenticated
using (public.owns_merchant(merchant_id));

drop policy if exists "merchant reads own inventory movements" on public.inventory_movements;
create policy "merchant reads own inventory movements"
on public.inventory_movements for select
to authenticated
using (public.owns_merchant(merchant_id));

-- Merchants can now sign up in the app and create their store profile from /setup-store.
