-- Optional shopper signup after checkout.

create table if not exists public.shopper_app_signups (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references public.merchant_profile(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  receipt_token text,
  email text not null,
  receipt_updates boolean not null default true,
  offers boolean not null default false,
  product_updates boolean not null default false,
  created_at timestamptz not null default now(),
  unique (email, receipt_token)
);

create index if not exists shopper_app_signups_email_idx on public.shopper_app_signups(email);
create index if not exists shopper_app_signups_merchant_id_idx on public.shopper_app_signups(merchant_id);

alter table public.shopper_app_signups enable row level security;

drop policy if exists "anon creates shopper app signups" on public.shopper_app_signups;
create policy "anon creates shopper app signups"
on public.shopper_app_signups for insert
to anon
with check (true);

drop policy if exists "merchant reads own shopper app signups" on public.shopper_app_signups;
create policy "merchant reads own shopper app signups"
on public.shopper_app_signups for select
to authenticated
using (public.owns_merchant(merchant_id));
