create extension if not exists pgcrypto;

do $$
begin
  create type public.fuel_kind as enum ('95E10', '98E5', 'DIESEL');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.stations (
  id uuid primary key default gen_random_uuid(),
  osm_type text not null check (osm_type in ('node', 'way', 'relation')),
  osm_id bigint not null,
  name text not null check (char_length(name) between 1 and 160),
  brand text not null default '',
  address text not null default '',
  latitude double precision not null check (latitude between 59 and 71),
  longitude double precision not null check (longitude between 19 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (osm_type, osm_id)
);

create table if not exists public.price_observations (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  fuel_type public.fuel_kind not null,
  price_eur numeric(5, 3) not null check (price_eur between 0.500 and 4.000),
  observed_at timestamptz not null default now(),
  reporter_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists price_observations_lookup_idx
  on public.price_observations (station_id, fuel_type, observed_at desc);

create index if not exists stations_coordinates_idx
  on public.stations (latitude, longitude);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists stations_set_updated_at on public.stations;
create trigger stations_set_updated_at
before update on public.stations
for each row execute function public.set_updated_at();

alter table public.stations enable row level security;
alter table public.price_observations enable row level security;

drop policy if exists "stations are publicly readable" on public.stations;
create policy "stations are publicly readable"
on public.stations for select
to anon, authenticated
using (true);

drop policy if exists "authenticated users can add stations" on public.stations;
create policy "authenticated users can add stations"
on public.stations for insert
to authenticated
with check ((select auth.uid()) is not null);

drop policy if exists "authenticated users can refresh station metadata" on public.stations;
create policy "authenticated users can refresh station metadata"
on public.stations for update
to authenticated
using ((select auth.uid()) is not null)
with check ((select auth.uid()) is not null);

drop policy if exists "authenticated users can submit their observations" on public.price_observations;
create policy "authenticated users can submit their observations"
on public.price_observations for insert
to authenticated
with check (reporter_id = (select auth.uid()));

revoke all on table public.stations from anon, authenticated;
grant select on table public.stations to anon, authenticated;
grant insert, update on table public.stations to authenticated;

revoke all on table public.price_observations from anon, authenticated;
grant insert on table public.price_observations to authenticated;

create or replace function public.nearby_stations_with_latest_prices(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 30,
  p_fuel_type public.fuel_kind default '95E10'
)
returns table (
  station_id uuid,
  osm_type text,
  osm_id bigint,
  latest_price numeric,
  observed_at timestamptz,
  sample_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.id,
    s.osm_type,
    s.osm_id,
    latest.price_eur,
    latest.observed_at,
    counts.sample_count
  from public.stations s
  join lateral (
    select po.price_eur, po.observed_at
    from public.price_observations po
    where po.station_id = s.id
      and po.fuel_type = p_fuel_type
      and po.observed_at >= now() - interval '14 days'
    order by po.observed_at desc
    limit 1
  ) latest on true
  left join lateral (
    select count(*)::bigint as sample_count
    from public.price_observations po
    where po.station_id = s.id
      and po.fuel_type = p_fuel_type
      and po.observed_at >= now() - interval '7 days'
  ) counts on true
  where p_lat between 59 and 71
    and p_lng between 19 and 32
    and p_radius_km between 1 and 100
    and 6371 * 2 * asin(
      sqrt(
        power(sin(radians(s.latitude - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(s.latitude)) *
        power(sin(radians(s.longitude - p_lng) / 2), 2)
      )
    ) <= p_radius_km
  order by latest.price_eur asc, latest.observed_at desc;
$$;

revoke all on function public.nearby_stations_with_latest_prices(double precision, double precision, double precision, public.fuel_kind) from public;
grant execute on function public.nearby_stations_with_latest_prices(double precision, double precision, double precision, public.fuel_kind) to anon, authenticated;
