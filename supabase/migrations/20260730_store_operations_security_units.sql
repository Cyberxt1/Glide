-- Store operations workflow updates.

alter table public.staff_members
drop constraint if exists staff_members_role_check;

alter table public.staff_members
add constraint staff_members_role_check
check (role in ('cashier', 'security'));

alter table public.staff_members
add column if not exists last_seen_at timestamptz,
add column if not exists current_station text;

alter table public.products
add column if not exists unit_label text not null default 'piece',
add column if not exists pack_label text,
add column if not exists units_per_pack integer not null default 1 check (units_per_pack >= 1),
add column if not exists pack_price numeric(12,2) check (pack_price is null or pack_price >= 0);

alter table public.order_items
add column if not exists sale_unit text not null default 'piece',
add column if not exists unit_quantity integer not null default 1 check (unit_quantity >= 1);

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

create index if not exists staff_members_last_seen_at_idx on public.staff_members(last_seen_at);
create index if not exists orders_pending_timeout_idx
  on public.orders(merchant_id, created_at)
  where status = 'pending_payment' and payment_status = 'pending';
