create or replace function public.nearby_station_price_history(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 30,
  p_fuel_type public.fuel_kind default '95E10'
)
returns table (
  station_id uuid,
  observed_day date,
  median_price numeric,
  observation_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.id,
    (po.observed_at at time zone 'Europe/Helsinki')::date,
    percentile_cont(0.5) within group (order by po.price_eur)::numeric(5, 3),
    count(*)::bigint
  from public.stations s
  join public.price_observations po on po.station_id = s.id
  where p_lat between 59 and 71
    and p_lng between 19 and 32
    and p_radius_km between 1 and 100
    and po.fuel_type = p_fuel_type
    and po.observed_at >= now() - interval '56 days'
    and 6371 * 2 * asin(
      least(
        1,
        sqrt(
          power(sin(radians(s.latitude - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(s.latitude)) *
          power(sin(radians(s.longitude - p_lng) / 2), 2)
        )
      )
    ) <= p_radius_km
  group by s.id, (po.observed_at at time zone 'Europe/Helsinki')::date
  order by s.id, (po.observed_at at time zone 'Europe/Helsinki')::date;
$$;

revoke all on function public.nearby_station_price_history(double precision, double precision, double precision, public.fuel_kind) from public;
grant execute on function public.nearby_station_price_history(double precision, double precision, double precision, public.fuel_kind) to anon, authenticated;
