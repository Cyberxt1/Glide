alter table public.orders
  add column if not exists spend_limit numeric(12,2),
  add column if not exists challenge_target numeric(12,2) not null default 15000,
  add column if not exists challenge_qualified boolean not null default false;

alter table public.orders drop constraint if exists orders_spend_limit_check;
alter table public.orders add constraint orders_spend_limit_check
  check (spend_limit is null or spend_limit >= 0);
