-- Approval-led merchant onboarding, receipt delivery tracking and platform events.
alter table public.merchant_profile
  add column if not exists onboarding_status text not null default 'approved',
  add column if not exists onboarding_submitted_at timestamptz,
  add column if not exists onboarding_reviewed_at timestamptz,
  add column if not exists onboarding_review_note text;

alter table public.merchant_profile drop constraint if exists merchant_profile_onboarding_status_check;
alter table public.merchant_profile add constraint merchant_profile_onboarding_status_check
  check (onboarding_status in ('draft', 'pending', 'approved', 'rejected', 'suspended'));

alter table public.orders
  add column if not exists receipt_delivery_status text not null default 'not_requested',
  add column if not exists receipt_sent_at timestamptz;

alter table public.orders drop constraint if exists orders_receipt_delivery_status_check;
alter table public.orders add constraint orders_receipt_delivery_status_check
  check (receipt_delivery_status in ('not_requested', 'pending', 'sent', 'failed'));

create table if not exists public.platform_system_logs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references public.merchant_profile(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_system_logs_store_created_idx
  on public.platform_system_logs(merchant_id, created_at desc);
alter table public.platform_system_logs enable row level security;
drop policy if exists "no direct system log access" on public.platform_system_logs;
create policy "no direct system log access" on public.platform_system_logs
  for all using (false) with check (false);

create or replace function public.protect_onboarding_review_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and tg_op = 'INSERT' then
    new.onboarding_status := 'pending';
    new.onboarding_reviewed_at := null;
    new.onboarding_review_note := null;
  elsif auth.uid() is not null and (
    new.onboarding_status is distinct from old.onboarding_status or
    new.onboarding_reviewed_at is distinct from old.onboarding_reviewed_at or
    new.onboarding_review_note is distinct from old.onboarding_review_note
  ) then
    raise exception 'Onboarding review fields are managed by Glide.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_onboarding_review_fields on public.merchant_profile;
create trigger protect_onboarding_review_fields
before insert or update on public.merchant_profile
for each row execute function public.protect_onboarding_review_fields();

create or replace function public.require_approved_store_for_active_qr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active and not exists (
    select 1 from public.merchant_profile
    where id = new.merchant_id and onboarding_status = 'approved'
  ) then
    raise exception 'Store approval is required before activating a checkout QR.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_approved_store_for_active_qr on public.qr_codes;
create trigger require_approved_store_for_active_qr
before insert or update on public.qr_codes
for each row execute function public.require_approved_store_for_active_qr();
