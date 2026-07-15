drop policy if exists "authenticated users can refresh station metadata" on public.stations;
revoke update on table public.stations from authenticated;

create index if not exists price_observations_reporter_rate_idx
  on public.price_observations (reporter_id, station_id, fuel_type, created_at desc);

create or replace function public.validate_price_observation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reporter_id is null or new.reporter_id <> auth.uid() then
    raise exception 'Reporter must match the authenticated user';
  end if;

  if new.observed_at < now() - interval '24 hours'
     or new.observed_at > now() + interval '5 minutes' then
    raise exception 'Observation time must be recent';
  end if;

  if exists (
    select 1
    from public.price_observations previous
    where previous.reporter_id = new.reporter_id
      and previous.station_id = new.station_id
      and previous.fuel_type = new.fuel_type
      and previous.created_at >= now() - interval '5 minutes'
  ) then
    raise exception 'Wait five minutes before reporting the same fuel again';
  end if;

  return new;
end;
$$;

drop trigger if exists price_observations_validate on public.price_observations;
create trigger price_observations_validate
before insert on public.price_observations
for each row execute function public.validate_price_observation();
