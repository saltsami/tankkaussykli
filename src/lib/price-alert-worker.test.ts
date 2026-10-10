import assert from "node:assert/strict";
import test from "node:test";
import { createECDH } from "node:crypto";
import { runPriceAlerts, type Delivery } from "./price-alert-worker.ts";
const now = Date.parse("2026-10-10T09:00:00Z");
const ec = createECDH("prime256v1"); ec.generateKeys();
const delivery: Delivery = { delivery_id: "delivery", lease_token: "lease", attempts: 1,
  endpoint: "https://fcm.googleapis.com/fcm/send/test", p256dh: ec.getPublicKey().toString("base64url"), auth: Buffer.alloc(16).toString("base64url"),
  station_name: "Asema", osm_type: "node", osm_id: 42, fuel_type: "DIESEL", price_eur: 2,
  observed_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 30000).toISOString() };
function fakeDb(jobs: Delivery[] = [delivery], finish = true) {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  return { calls, async rpc(name: string, params: Record<string, unknown>) {
    calls.push({ name, params });
    return { data: name === "enqueue_price_alerts" ? 1 : name === "claim_price_alert_deliveries" ? jobs : finish, error: null };
  } };
}
test("worker sends actual observation time, navigation, stable delivery tag and freshness-bounded TTL", async () => {
  const db = fakeDb();
  const result = await runPriceAlerts(db, async (_s, payload, options) => {
    const parsed = JSON.parse(payload);
    assert.equal(parsed.observedAt, delivery.observed_at); assert.equal(parsed.tag, "price-alert-delivery");
    assert.equal(parsed.url, "/?station=node-42&fuel=DIESEL"); assert.equal(options.TTL, 30); assert.equal(options.timeout, 8000);
    assert.match(parsed.body, /2\.000/);
  }, 24, () => now);
  assert.equal(result.sent, 1); assert.equal(db.calls[2].params.p_token, "lease");
});
test("404 and 410 disable expired subscriptions; provider failures go to retry", async () => {
  for (const code of [404, 410, 429, 500]) {
    const db = fakeDb(); const result = await runPriceAlerts(db, async () => { throw { statusCode: code }; }, 24, () => now);
    assert.equal(db.calls[2].params.p_result, code === 404 || code === 410 ? "gone" : "retry");
    assert.equal(result.sent, 0);
  }
});
test("expired observations and invalid stored endpoints are never sent", async () => {
  for (const job of [{ ...delivery, expires_at: new Date(now - 1).toISOString() }, { ...delivery, endpoint: "https://localhost/test" }]) {
    let sent = false; await runPriceAlerts(fakeDb([job]), async () => { sent = true; }, 24, () => now); assert.equal(sent, false);
  }
});
test("database failures abort; lost leases are not counted as delivered", async () => {
  await assert.rejects(runPriceAlerts({ async rpc() { return { data: null, error: new Error("DB down") }; } }, async () => {}, 24));
  const result = await runPriceAlerts(fakeDb([delivery], false), async () => {}, 24, () => now);
  assert.equal(result.obsolete, 1); assert.equal(result.sent, 0);
});
