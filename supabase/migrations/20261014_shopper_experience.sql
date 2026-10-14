-- Post-checkout customer feedback and richer early-access profiles.

alter table public.shopper_app_signups
add column if not exists full_name text,
add column if not exists phone text,
add column if not exists early_access boolean not null default true;

create table if not exists public.shopper_feedback (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  tags text[] not null default '{}',
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id)
);

create index if not exists shopper_feedback_merchant_created_idx
on public.shopper_feedback(merchant_id, created_at desc);

alter table public.shopper_feedback enable row level security;

drop policy if exists "merchant reads own shopper feedback" on public.shopper_feedback;
create policy "merchant reads own shopper feedback"
on public.shopper_feedback for select
to authenticated
using (public.owns_merchant(merchant_id));

