-- Freshness always uses observed_at. Existing observations are never rewritten.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 1 and 2048),
  p256dh text not null, auth text not null,
  enabled boolean not null default true, updated_at timestamptz not null default now()
);
create table public.price_alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  fuel_type public.fuel_kind not null,
  threshold numeric(5,3) not null check (threshold between 0.500 and 4.000),
  below_threshold boolean not null default false,
  last_observation_id uuid, last_observed_at timestamptz, last_sent_at timestamptz,
  unique (user_id, station_id, fuel_type)
);
create table public.price_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.price_alert_rules(id) on delete cascade,
  observation_id uuid not null, price_eur numeric(5,3) not null,
  observed_at timestamptz not null, expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','cancelled','failed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  lease_until timestamptz, lease_token uuid, last_error text, sent_at timestamptz,
  unique (rule_id, observation_id)
);
create index price_alert_deliveries_pending_idx on public.price_alert_deliveries(next_attempt_at) where status in ('pending', 'sending');
create index price_alert_rules_subscription_idx on public.price_alert_rules(subscription_id);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
alter table public.price_alert_rules enable row level security;
alter table public.price_alert_deliveries enable row level security;
-- Writes pass through the authenticated API, with explicit owner filters.
revoke all on public.push_subscriptions, public.price_alert_rules, public.price_alert_deliveries from anon, authenticated;
grant all on public.push_subscriptions, public.price_alert_rules, public.price_alert_deliveries to service_role;

create function public.save_price_alert(p_user_id uuid, p_station_id uuid, p_fuel public.fuel_kind, p_threshold numeric,
  p_endpoint text, p_p256dh text, p_auth text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare subscription uuid; rule uuid; reactivating boolean;
begin
  perform pg_advisory_xact_lock(20261010, 1);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from push_subscriptions s where s.user_id = p_user_id
    and not exists (select 1 from price_alert_rules r where r.subscription_id = s.id);
  select not enabled into reactivating from push_subscriptions where endpoint = p_endpoint and user_id = p_user_id;
  perform 1 from price_alert_rules where user_id = p_user_id order by id for update;
  if not exists (select 1 from push_subscriptions where endpoint = p_endpoint)
    and (select count(*) from push_subscriptions where user_id = p_user_id) >= 10 then raise exception 'Subscription limit reached'; end if;
  if not exists (select 1 from price_alert_rules where user_id = p_user_id and station_id = p_station_id and fuel_type = p_fuel)
    and (select count(*) from price_alert_rules where user_id = p_user_id) >= 100 then raise exception 'Alert limit reached'; end if;
  insert into push_subscriptions(user_id, endpoint, p256dh, auth) values (p_user_id, p_endpoint, p_p256dh, p_auth)
    on conflict(endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, enabled = true, updated_at = now()
    where push_subscriptions.user_id = p_user_id returning id into subscription;
  if subscription is null then raise exception 'Subscription belongs to another user'; end if;
  if reactivating then
    update price_alert_rules set below_threshold = false, last_observation_id = null where subscription_id = subscription;
  end if;
  update price_alert_deliveries d set status = 'cancelled', lease_token = null from price_alert_rules r
    where d.rule_id = r.id and r.user_id = p_user_id and r.station_id = p_station_id and r.fuel_type = p_fuel
    and r.threshold <> p_threshold and d.status in ('pending','sending');
  insert into price_alert_rules(user_id, subscription_id, station_id, fuel_type, threshold)
    values (p_user_id, subscription, p_station_id, p_fuel, p_threshold)
    on conflict(user_id, station_id, fuel_type) do update set subscription_id = excluded.subscription_id, threshold = excluded.threshold,
      below_threshold = case when price_alert_rules.threshold <> excluded.threshold then false else price_alert_rules.below_threshold end,
      last_observation_id = case when price_alert_rules.threshold <> excluded.threshold then null else price_alert_rules.last_observation_id end
    returning id into rule;
  return rule;
end $$;

create function public.enqueue_price_alerts(p_max_age_hours integer default 24)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; latest record; queued integer := 0; inserted integer;
begin
  if p_max_age_hours not between 1 and 48 or p_max_age_hours is null then raise exception 'Invalid freshness window'; end if;
  perform pg_advisory_xact_lock(20261010, 1);
  for r in select a.* from price_alert_rules a join push_subscriptions s on s.id = a.subscription_id where s.enabled for update of a loop
    select o.* into latest from price_observations o where o.station_id = r.station_id and o.fuel_type = r.fuel_type and o.observed_at <= now()
      order by o.observed_at desc, o.created_at desc, o.id desc limit 1;
    -- Missing/stale data does NOT rearm the watch or acquire a new timestamp.
    if latest.id is null or latest.observed_at < now() - make_interval(hours => p_max_age_hours) then continue; end if;
    if latest.id is not distinct from r.last_observation_id or latest.observed_at < r.last_observed_at then continue; end if;
    if latest.price_eur > r.threshold then
      update price_alert_deliveries set status = 'cancelled', lease_token = null where rule_id = r.id and status in ('pending','sending');
    elsif not r.below_threshold then
      insert into price_alert_deliveries(rule_id, observation_id, price_eur, observed_at, expires_at, next_attempt_at)
        values (r.id, latest.id, latest.price_eur, latest.observed_at, latest.observed_at + make_interval(hours => p_max_age_hours),
          greatest(now(), coalesce(r.last_sent_at + interval '12 hours', now())))
        on conflict(rule_id, observation_id) do update set status = 'pending', attempts = 0,
          expires_at = excluded.expires_at, next_attempt_at = excluded.next_attempt_at,
          lease_token = null, lease_until = null, last_error = null
          where price_alert_deliveries.status = 'cancelled' and price_alert_deliveries.sent_at is null;
      get diagnostics inserted = row_count;
      queued := queued + inserted;
    end if;
    update price_alert_rules set below_threshold = latest.price_eur <= r.threshold,
      last_observation_id = latest.id, last_observed_at = latest.observed_at where id = r.id;
  end loop;
  return queued;
end $$;

create function public.claim_price_alert_deliveries(p_limit integer default 20, p_max_age_hours integer default 24)
returns table (delivery_id uuid, lease_token uuid, attempts integer, endpoint text, p256dh text, auth text,
  station_name text, osm_type text, osm_id bigint, fuel_type public.fuel_kind, price_eur numeric, observed_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 100 or p_limit is null or p_max_age_hours not between 1 and 48 or p_max_age_hours is null then
    raise exception 'Invalid batch configuration'; end if;
  update price_alert_deliveries d set status = 'cancelled', lease_token = null where d.status in ('pending','sending') and (
    d.expires_at <= now() or d.observed_at < now() - make_interval(hours => p_max_age_hours)
    or not exists (select 1 from price_alert_rules r join push_subscriptions s on s.id = r.subscription_id
      where r.id = d.rule_id and s.enabled and r.below_threshold
      and not exists (select 1 from price_observations o where o.station_id = r.station_id and o.fuel_type = r.fuel_type
        and o.observed_at <= now() and o.observed_at >= d.observed_at and o.price_eur > r.threshold)));
  update price_alert_deliveries d set status = 'failed', last_error = 'Retry limit reached'
    where d.status in ('pending','sending') and d.attempts >= 5 and (d.lease_until is null or d.lease_until <= now());
  return query with candidates as (
    select d.id from price_alert_deliveries d where (d.status = 'pending' or (d.status = 'sending' and d.lease_until <= now()))
      and d.next_attempt_at <= now() and d.attempts < 5 order by d.next_attempt_at, d.id limit p_limit for update skip locked
  ), claimed as (
    update price_alert_deliveries d set status = 'sending', attempts = d.attempts + 1,
      lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes'
      from candidates c where d.id = c.id returning d.*
  ) select d.id, d.lease_token, d.attempts, s.endpoint, s.p256dh, s.auth, st.name, st.osm_type, st.osm_id,
    r.fuel_type, d.price_eur, d.observed_at, least(d.expires_at, d.observed_at + make_interval(hours => p_max_age_hours))
    from claimed d join price_alert_rules r on r.id = d.rule_id join push_subscriptions s on s.id = r.subscription_id
    join stations st on st.id = r.station_id;
end $$;

create function public.finish_price_alert_delivery(p_id uuid, p_token uuid, p_result text, p_error text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.price_alert_deliveries;
begin
  perform pg_advisory_xact_lock(20261010, 1);
  -- Lock parent before child, matching rule deletion/cascade lock order.
  perform 1 from price_alert_rules where id = (select rule_id from price_alert_deliveries where id = p_id) for update;
  select * into d from price_alert_deliveries where id = p_id and lease_token = p_token and status = 'sending' for update;
  if d.id is null then return false; end if;
  if p_result = 'sent' then
    update price_alert_deliveries set status = 'sent', sent_at = now(), lease_until = null, lease_token = null where id = d.id;
    update price_alert_rules set last_sent_at = now() where id = d.rule_id;
  elsif p_result = 'gone' then
    update push_subscriptions set enabled = false where id = (select subscription_id from price_alert_rules where id = d.rule_id);
    update price_alert_deliveries set status = 'cancelled', lease_token = null, last_error = 'Subscription expired'
      where rule_id in (select id from price_alert_rules where subscription_id = (select subscription_id from price_alert_rules where id = d.rule_id))
      and status in ('pending','sending');
  elsif p_result = 'retry' then
    update price_alert_deliveries set status = case when attempts >= 5 then 'failed' else 'pending' end,
      next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, attempts)::integer)),
      lease_until = null, lease_token = null, last_error = left(p_error, 160) where id = d.id;
  else raise exception 'Invalid delivery result'; end if;
  return true;
end $$;
revoke all on function public.save_price_alert(uuid,uuid,public.fuel_kind,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.enqueue_price_alerts(integer) from public, anon, authenticated;
revoke all on function public.claim_price_alert_deliveries(integer,integer) from public, anon, authenticated;
revoke all on function public.finish_price_alert_delivery(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.save_price_alert(uuid,uuid,public.fuel_kind,numeric,text,text,text) to service_role;
grant execute on function public.enqueue_price_alerts(integer) to service_role;
grant execute on function public.claim_price_alert_deliveries(integer,integer) to service_role;
grant execute on function public.finish_price_alert_delivery(uuid,uuid,text,text) to service_role;
