-- Shopper routes must behave the same even when the browser already has a Glide login.
-- PostgreSQL's `anon` and `authenticated` roles are separate, so public checkout
-- policies need to cover both roles.
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

drop policy if exists "public reads qr codes" on public.qr_codes;
create policy "public reads qr codes"
on public.qr_codes for select
to anon, authenticated
using (true);

drop policy if exists "public reads paid receipts" on public.orders;
create policy "public reads paid receipts"
on public.orders for select
to anon, authenticated
using (receipt_token is not null and status in ('paid', 'exited'));

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
