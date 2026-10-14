alter table public.merchant_profile add column if not exists geofence_latitude double precision;
alter table public.merchant_profile add column if not exists geofence_longitude double precision;
alter table public.merchant_profile add column if not exists geofence_radius_meters integer not null default 150;
alter table public.merchant_profile add column if not exists geofence_enabled boolean not null default false;

alter table public.merchant_profile drop constraint if exists merchant_profile_geofence_radius_check;
alter table public.merchant_profile add constraint merchant_profile_geofence_radius_check
  check (geofence_radius_meters between 25 and 5000);
