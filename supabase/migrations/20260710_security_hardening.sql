-- Security hardening for the Glide store MVP.
-- Run this after the earlier shopper/session migrations.

drop policy if exists "anon creates shopper sessions" on public.shopper_sessions;
drop policy if exists "anon updates shopper sessions" on public.shopper_sessions;
drop policy if exists "anon deletes shopper sessions" on public.shopper_sessions;

drop policy if exists "anon creates shopper app signups" on public.shopper_app_signups;

drop policy if exists "public reads qr codes" on public.qr_codes;
drop policy if exists "public reads active qr codes" on public.qr_codes;
create policy "public reads active qr codes"
on public.qr_codes for select
to anon
using (is_active);
