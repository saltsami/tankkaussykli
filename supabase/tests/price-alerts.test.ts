import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const user = "00000000-0000-0000-0000-000000000001";
const otherUser = "00000000-0000-0000-0000-000000000002";
const station = "00000000-0000-0000-0000-000000000003";
const endpoint = "https://fcm.googleapis.com/fcm/send/test";
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${user}'), ('${otherUser}');`);
  // PGlite has built-in gen_random_uuid; the extension installer is Supabase-specific.
  for (const file of ["202607150001_initial_schema.sql", "202607150002_price_history_rpc.sql", "202607150003_submission_guardrails.sql", "202610100001_server_price_alerts.sql"]) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    await db.exec(sql.replace("create extension if not exists pgcrypto;", ""));
  }
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false);
    insert into public.stations(id, osm_type, osm_id, name, latitude, longitude) values ('${station}', 'node', 42, 'Test', 62, 25);`);
  async function save(fuel = "95E10", threshold = 2, owner = user) {
    return (await db.query<{ id: string }>("select save_price_alert($1,$2,$3,$4,$5,'key','auth') as id", [owner, station, fuel, threshold, endpoint])).rows[0].id;
  }
  async function observe(price: number, age = "1 minute", fuel = "95E10") {
    // Historical fixtures bypass only the original submission-time guard; all alert SQL is real.
    await db.exec("alter table price_observations disable trigger price_observations_validate");
    const result = await db.query<{ id: string }>("insert into price_observations(station_id,fuel_type,price_eur,observed_at,reporter_id) values ($1,$2,$3,now()-$4::interval,$5) returning id", [station, fuel, price, age, user]);
    await db.exec("alter table price_observations enable trigger price_observations_validate");
    return result.rows[0].id;
  }
  async function enqueue(hours = 24) { return (await db.query<{ n: number }>("select enqueue_price_alerts($1) as n", [hours])).rows[0].n; }
  async function claim() { return (await db.query<{ delivery_id: string; lease_token: string; attempts: number }>("select * from claim_price_alert_deliveries(20,24)")).rows; }
  async function finish(job: { delivery_id: string; lease_token: string }, result: string) {
    return (await db.query<{ ok: boolean }>("select finish_price_alert_delivery($1,$2,$3,'test') as ok", [job.delivery_id, job.lease_token, result])).rows[0].ok;
  }
  return { db, save, observe, enqueue, claim, finish };
}
test("actual migrations: 2 €/l petrol/diesel, missing/future/stale observations and latest high price", async () => {
  const f = await setup();
  try {
    await f.save(); await f.save("DIESEL");
    assert.equal(await f.enqueue(), 0);
    await f.observe(1.8, "25 hours"); await f.observe(1.8, "-1 hour", "DIESEL");
    assert.equal(await f.enqueue(), 0);
    await f.observe(1.9, "2 hours"); await f.observe(2.1, "1 hour");
    assert.equal(await f.enqueue(), 0, "a newer expensive price overrides old cheap data");
    await f.observe(2, "1 minute"); await f.observe(1.99, "1 minute", "DIESEL");
    assert.equal(await f.enqueue(), 2); assert.equal(await f.enqueue(), 0);
    assert.equal((await f.claim()).length, 2);
  } finally { await f.db.close(); }
});
test("actual migrations: one alert per low-price episode, real high rearms, cooldown delays delivery", async () => {
  const f = await setup();
  try {
    await f.save(); await f.observe(1.9, "4 hours"); assert.equal(await f.enqueue(), 1);
    const [job] = await f.claim(); assert.equal((await f.claim()).length, 0, "active lease is exclusive");
    assert.equal(await f.finish(job, "sent"), true); assert.equal(await f.finish(job, "sent"), false);
    await f.observe(1.8, "3 hours"); assert.equal(await f.enqueue(), 0, "new cheap observation is still the same episode");
    await f.observe(2.1, "2 hours"); assert.equal(await f.enqueue(), 0);
    await f.observe(1.7, "1 hour"); assert.equal(await f.enqueue(), 1);
    assert.equal((await f.claim()).length, 0, "12h cooldown");
    await f.db.exec("update price_alert_deliveries set next_attempt_at=now() where status='pending'");
    assert.equal((await f.claim()).length, 1);
  } finally { await f.db.close(); }
});
test("actual migrations: pending data expires or is superseded before sending", async () => {
  const f = await setup();
  try {
    await f.save(); await f.observe(1.9, "2 hours"); await f.enqueue();
    await f.observe(2.1, "1 hour"); assert.equal((await f.claim()).length, 0);
    await f.enqueue(); await f.observe(1.8, "1 minute"); await f.enqueue();
    await f.db.exec("update price_alert_deliveries set expires_at=now()-interval '1 second' where status='pending'");
    assert.equal((await f.claim()).length, 0);
    assert.equal(await f.enqueue(), 0, "expiry never fabricates another observation");
  } finally { await f.db.close(); }
});
test("actual migrations: retries back off, leases recover, old tokens fail, 410 disables all subscription jobs", async () => {
  const f = await setup();
  try {
    await f.save(); await f.observe(1.8); await f.enqueue();
    const [job] = await f.claim(); await f.finish(job, "retry"); assert.equal((await f.claim()).length, 0);
    await f.db.exec("update price_alert_deliveries set next_attempt_at=now()");
    const [retried] = await f.claim(); assert.equal(retried.attempts, 2);
    await f.db.exec("update price_alert_deliveries set lease_until=now()-interval '1 second'");
    const [recovered] = await f.claim(); assert.equal(recovered.attempts, 3);
    assert.equal(await f.finish(retried, "sent"), false); await f.finish(recovered, "gone");
    assert.equal((await f.db.query<{ enabled: boolean }>("select enabled from push_subscriptions")).rows[0].enabled, false);
    assert.equal(await f.enqueue(), 0); assert.equal((await f.claim()).length, 0);
  } finally { await f.db.close(); }
});
test("actual migrations: permissions block direct reads/writes and cron RPC; ownership cannot be taken over", async () => {
  const f = await setup();
  try {
    await f.save();
    await assert.rejects(f.save("DIESEL", 2, otherUser), /another user/);
    await f.db.exec("set role authenticated");
    for (const sql of ["select * from push_subscriptions", "select * from price_alert_rules", "select * from price_alert_deliveries", "select enqueue_price_alerts(24)", "select * from claim_price_alert_deliveries(20,24)", `select save_price_alert('${user}','${station}','DIESEL',2,'url','key','auth')`]) {
      await assert.rejects(f.db.query(sql), /permission denied/);
    }
    await f.db.exec("reset role");
    await f.db.query("delete from price_alert_rules where user_id=$1", [otherUser]);
    assert.equal((await f.db.query("select * from price_alert_rules")).rows.length, 1);
    await f.db.query("delete from price_alert_rules where user_id=$1", [user]);
    assert.equal((await f.db.query("select * from price_alert_deliveries")).rows.length, 0);
  } finally { await f.db.close(); }
});
test("actual migrations: threshold changes reevaluate once, never resend the same observation", async () => {
  const f = await setup();
  try {
    await f.save("95E10", 1.7); await f.observe(1.8); assert.equal(await f.enqueue(), 0);
    await f.save("95E10", 2); assert.equal(await f.enqueue(), 1);
    const [job] = await f.claim(); await f.finish(job, "sent");
    await f.save("95E10", 2.1); assert.equal(await f.enqueue(), 0);
    await f.save("95E10", 2.1); assert.equal(await f.enqueue(), 0);
  } finally { await f.db.close(); }
});
test("actual migrations: changing threshold before send preserves an unsent eligible delivery", async () => {
  const f = await setup();
  try {
    await f.save(); await f.observe(1.8); assert.equal(await f.enqueue(), 1);
    await f.save("95E10", 2.1); assert.equal(await f.enqueue(), 1);
    assert.equal((await f.claim()).length, 1);
  } finally { await f.db.close(); }
});
test("actual migrations: reactivating a gone subscription retries unsent data, but not sent data", async () => {
  const f = await setup();
  try {
    await f.save(); await f.observe(1.8); await f.enqueue();
    const [job] = await f.claim(); await f.finish(job, "gone");
    await f.save(); assert.equal(await f.enqueue(), 1);
    const [retry] = await f.claim(); await f.finish(retry, "sent");
    await f.db.exec("update push_subscriptions set enabled=false");
    await f.save(); assert.equal(await f.enqueue(), 0);
  } finally { await f.db.close(); }
});
test("actual migrations: insertion time never refreshes a backdated observation and stricter freshness rejects old queued data", async () => {
  const f = await setup();
  try {
    await f.save(); const id = await f.observe(1.8, "23 hours");
    assert.equal(await f.enqueue(), 1);
    assert.equal((await f.db.query("select * from claim_price_alert_deliveries(20,6)")).rows.length, 0);
    const recorded = (await f.db.query<{ observed_at: Date }>("select observed_at from price_observations where id=$1", [id])).rows[0].observed_at;
    await f.db.exec("update price_observations set observed_at=now()-interval '25 hours'");
    assert.equal(await f.enqueue(), 0);
    assert.ok(recorded);
  } finally { await f.db.close(); }
});
test("actual migrations: fifth failed attempt is terminal", async () => {
  const f = await setup();
  try {
    await f.save(); await f.observe(1.8); await f.enqueue();
    for (let i = 1; i <= 5; i++) {
      await f.db.exec("update price_alert_deliveries set next_attempt_at=now()");
      const [job] = await f.claim(); assert.equal(job.attempts, i); await f.finish(job, "retry");
    }
    assert.equal((await f.claim()).length, 0);
    assert.equal((await f.db.query<{ status: string }>("select status from price_alert_deliveries")).rows[0].status, "failed");
  } finally { await f.db.close(); }
});
