-- Ensure every existing and future store receives a terminal gate code.
alter table public.merchant_profile
  alter column terminal_auth_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

alter table public.staff_members
  alter column terminal_auth_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

update public.merchant_profile
set terminal_auth_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where terminal_auth_code is null or btrim(terminal_auth_code) = '';

update public.staff_members
set terminal_auth_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where terminal_auth_code is null or btrim(terminal_auth_code) = '';
