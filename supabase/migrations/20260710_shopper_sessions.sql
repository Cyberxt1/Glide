-- Anonymous shopper sessions for QR checkout recovery and cleanup.

create table if not exists public.shopper_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  qr_code_id uuid references public.qr_codes(id) on delete set null,
  merchant_id uuid references public.merchant_profile(id) on delete cascade,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists shopper_sessions_session_id_idx on public.shopper_sessions(session_id);
create index if not exists shopper_sessions_expires_at_idx on public.shopper_sessions(expires_at);
create index if not exists shopper_sessions_merchant_id_idx on public.shopper_sessions(merchant_id);

alter table public.shopper_sessions enable row level security;

drop policy if exists "anon creates shopper sessions" on public.shopper_sessions;
create policy "anon creates shopper sessions"
on public.shopper_sessions for insert
to anon
with check (true);

drop policy if exists "anon updates shopper sessions" on public.shopper_sessions;
create policy "anon updates shopper sessions"
on public.shopper_sessions for update
to anon
using (true)
with check (true);

drop policy if exists "anon deletes shopper sessions" on public.shopper_sessions;
create policy "anon deletes shopper sessions"
on public.shopper_sessions for delete
to anon
using (true);

drop policy if exists "merchant reads own shopper sessions" on public.shopper_sessions;
create policy "merchant reads own shopper sessions"
on public.shopper_sessions for select
to authenticated
using (public.owns_merchant(merchant_id));
