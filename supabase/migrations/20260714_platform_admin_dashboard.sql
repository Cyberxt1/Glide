  -- Platform admin support for Glide master control.

  create table if not exists public.platform_admin_audit_logs (
    id uuid primary key default gen_random_uuid(),
    admin_email text not null,
    action text not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  create index if not exists platform_admin_audit_logs_admin_email_idx
  on public.platform_admin_audit_logs(admin_email);

  create index if not exists platform_admin_audit_logs_action_idx
  on public.platform_admin_audit_logs(action);

  create index if not exists platform_admin_audit_logs_created_at_idx
  on public.platform_admin_audit_logs(created_at desc);

  alter table public.platform_admin_audit_logs enable row level security;

  drop policy if exists "no direct platform admin audit access" on public.platform_admin_audit_logs;
  create policy "no direct platform admin audit access"
  on public.platform_admin_audit_logs
  for all
  using (false)
  with check (false);
