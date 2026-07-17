-- Cashier terminal gate codes for second-layer store authentication.

alter table public.merchant_profile
add column if not exists terminal_auth_code text;

alter table public.staff_members
add column if not exists terminal_auth_code text;

update public.merchant_profile
set terminal_auth_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where terminal_auth_code is null;

update public.staff_members
set terminal_auth_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where terminal_auth_code is null;
