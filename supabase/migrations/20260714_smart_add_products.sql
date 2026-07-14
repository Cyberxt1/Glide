-- Smart Add and shared barcode product database.

create table if not exists public.global_products (
  id uuid primary key default gen_random_uuid(),
  barcode text not null unique,
  name text not null,
  category text,
  size text,
  image_url text,
  label_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
add column if not exists global_product_id uuid references public.global_products(id) on delete set null;

alter table public.products
add column if not exists size text;

alter table public.products
add column if not exists image_url text;

create table if not exists public.smart_add_links (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  token text not null unique,
  is_active boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.smart_add_items (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.smart_add_links(id) on delete cascade,
  merchant_id uuid not null references public.merchant_profile(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  global_product_id uuid references public.global_products(id) on delete set null,
  barcode text not null,
  captured_image_url text,
  extracted_text text,
  submitted_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists global_products_barcode_idx on public.global_products(barcode);
create index if not exists products_global_product_id_idx on public.products(global_product_id);
create index if not exists smart_add_links_token_idx on public.smart_add_links(token);
create index if not exists smart_add_links_merchant_id_idx on public.smart_add_links(merchant_id);
create index if not exists smart_add_items_link_id_idx on public.smart_add_items(link_id);
create index if not exists smart_add_items_merchant_id_idx on public.smart_add_items(merchant_id);

drop trigger if exists global_products_touch_updated_at on public.global_products;
create trigger global_products_touch_updated_at
before update on public.global_products
for each row execute function public.touch_updated_at();

alter table public.global_products enable row level security;
alter table public.smart_add_links enable row level security;
alter table public.smart_add_items enable row level security;

drop policy if exists "public reads global products by barcode" on public.global_products;

drop policy if exists "merchant reads global products" on public.global_products;
create policy "merchant reads global products"
on public.global_products for select
to authenticated
using (true);

drop policy if exists "merchant reads own smart add links" on public.smart_add_links;
create policy "merchant reads own smart add links"
on public.smart_add_links for select
to authenticated
using (public.owns_merchant(merchant_id));

drop policy if exists "merchant manages own smart add links" on public.smart_add_links;
create policy "merchant manages own smart add links"
on public.smart_add_links for all
to authenticated
using (public.owns_merchant(merchant_id))
with check (public.owns_merchant(merchant_id));

drop policy if exists "merchant reads own smart add items" on public.smart_add_items;
create policy "merchant reads own smart add items"
on public.smart_add_items for select
to authenticated
using (public.owns_merchant(merchant_id));
