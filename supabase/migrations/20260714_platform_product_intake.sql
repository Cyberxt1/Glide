-- Platform product database intake and visibility controls.

alter table public.global_products
add column if not exists is_hidden boolean not null default false;

create index if not exists global_products_is_hidden_idx
on public.global_products(is_hidden);

create index if not exists global_products_category_idx
on public.global_products(category);

create table if not exists public.platform_product_intake_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  created_by_email text not null,
  is_active boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_product_intake_items (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.platform_product_intake_links(id) on delete cascade,
  global_product_id uuid references public.global_products(id) on delete set null,
  barcode text not null,
  submitted_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_product_intake_links_token_idx
on public.platform_product_intake_links(token);

create index if not exists platform_product_intake_links_created_at_idx
on public.platform_product_intake_links(created_at desc);

create index if not exists platform_product_intake_items_link_id_idx
on public.platform_product_intake_items(link_id);

alter table public.platform_product_intake_links enable row level security;
alter table public.platform_product_intake_items enable row level security;

drop policy if exists "no direct platform product intake link access" on public.platform_product_intake_links;
create policy "no direct platform product intake link access"
on public.platform_product_intake_links
for all
using (false)
with check (false);

drop policy if exists "no direct platform product intake item access" on public.platform_product_intake_items;
create policy "no direct platform product intake item access"
on public.platform_product_intake_items
for all
using (false)
with check (false);
