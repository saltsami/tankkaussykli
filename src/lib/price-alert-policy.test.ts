import assert from "node:assert/strict";
import test from "node:test";
import { createECDH } from "node:crypto";
import { maxAgeHours, validCronAuthorization, validateAlertInput, validateSubscription } from "./price-alert-policy.ts";
import { shouldNotifyLocally } from "./local-alert-policy.ts";
const ec = createECDH("prime256v1"); ec.generateKeys();
export const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: {
  p256dh: ec.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url"),
} };
const station = { osmType: "node", osmId: 42, name: "Asema", brand: "", address: "", lat: 62, lng: 25 };
test("2 €/l is accepted for both petrol types and diesel; range and precision are enforced", () => {
  for (const fuel of ["95E10", "98E5", "DIESEL"]) assert.equal(validateAlertInput({ station, fuel, threshold: 2, subscription }).threshold, 2);
  for (const threshold of [0.49, 4.01, NaN, "2", 1.2345]) assert.throws(() => validateAlertInput({ station, fuel: "DIESEL", threshold, subscription }));
  assert.throws(() => validateAlertInput({ station: { ...station, osmType: "demo" }, fuel: "95E10", threshold: 2, subscription }));
});
test("push targets reject SSRF, credentials, ports, lookalike domains and invalid EC keys", () => {
  assert.deepEqual(validateSubscription(subscription), subscription);
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://fcm.googleapis.com.evil.test/x", "https://fcm.googleapis.com:8443/x", "https://user:secret@fcm.googleapis.com/x", "https://evilpush.services.mozilla.com/x"]) {
    assert.throws(() => validateSubscription({ ...subscription, endpoint }));
  }
  assert.throws(() => validateSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: "a".repeat(87) } }));
});
test("cron fails closed without a secret and requires an exact bearer token", () => {
  assert.equal(validCronAuthorization(null, "secret"), false);
  assert.equal(validCronAuthorization("Bearer secret"), false);
  assert.equal(validCronAuthorization("Bearer wrong", "secret"), false);
  assert.equal(validCronAuthorization("Bearer secret ", "secret"), false);
  assert.equal(validCronAuthorization("Bearer secret", "secret"), true);
});
test("freshness is configurable but bounded", () => {
  assert.equal(maxAgeHours(), 24); assert.equal(maxAgeHours("6"), 6);
  for (const value of ["0", "49", "1.5", "NaN"]) assert.throws(() => maxAgeHours(value));
});
test("local fallback excludes stale, future, demo, same-observation and cooldown alerts", () => {
  const now = Date.parse("2026-10-10T09:00Z");
  const observedAt = new Date(now - 1000).toISOString();
  assert.equal(shouldNotifyLocally(observedAt, 2, 2, {}, now, false), true);
  assert.equal(shouldNotifyLocally(observedAt, 2.001, 2, {}, now, false), false);
  for (const date of ["invalid", new Date(now + 1).toISOString(), new Date(now - 86400001).toISOString()]) assert.equal(shouldNotifyLocally(date, 1, 2, {}, now, false), false);
  assert.equal(shouldNotifyLocally(observedAt, 1, 2, {}, now, true), false);
  assert.equal(shouldNotifyLocally(observedAt, 1, 2, { observedAt }, now, false), false);
  assert.equal(shouldNotifyLocally(observedAt, 1, 2, { notifiedAt: now - 1000 }, now, false), false);
});
