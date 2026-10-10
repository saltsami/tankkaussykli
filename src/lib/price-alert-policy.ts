import { ECDH, timingSafeEqual } from "node:crypto";
import { FUEL_TYPES, type FuelType } from "./types.ts";

export const DEFAULT_MAX_AGE_HOURS = 24;
export function maxAgeHours(value?: string) {
  const hours = value === undefined || value === "" ? DEFAULT_MAX_AGE_HOURS : Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 48) throw new Error("PRICE_ALERT_MAX_AGE_HOURS must be an integer from 1 to 48");
  return hours;
}
export function validCronAuthorization(header: string | null, secret?: string) {
  if (!secret || !header) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export type SavedAlertInput = {
  station: { osmType: "node" | "way" | "relation"; osmId: number; name: string; brand: string; address: string; lat: number; lng: number };
  fuel: FuelType; threshold: number;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
};
export function validateSubscription(value: unknown): SavedAlertInput["subscription"] {
  if (!value || typeof value !== "object") throw new Error("Puuttuva Push-tilaus.");
  const s = value as SavedAlertInput["subscription"];
  if (typeof s.endpoint !== "string" || s.endpoint.length > 2048) throw new Error("Virheellinen Push-osoite.");
  const url = new URL(s.endpoint);
  const allowed = url.hostname === "fcm.googleapis.com" || url.hostname === "web.push.apple.com" ||
    url.hostname === "push.services.mozilla.com" || url.hostname.endsWith(".push.services.mozilla.com") ||
    url.hostname.endsWith(".notify.windows.com");
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !allowed) {
    throw new Error("Push-palvelua ei sallita. Osoitteen on oltava tunnetun selainpalvelun HTTPS-osoite.");
  }
  if (!s.keys || typeof s.keys.p256dh !== "string" || typeof s.keys.auth !== "string" ||
    !/^[A-Za-z0-9_-]{87}$/.test(s.keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(s.keys.auth)) throw new Error("Virheelliset Push-avaimet.");
  ECDH.convertKey(Buffer.from(s.keys.p256dh, "base64url"), "prime256v1");
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}
export function validateAlertInput(value: unknown): SavedAlertInput {
  if (!value || typeof value !== "object") throw new Error("Virheellinen hintavahti.");
  const input = value as SavedAlertInput;
  if (!FUEL_TYPES.includes(input.fuel) || typeof input.threshold !== "number" || !Number.isFinite(input.threshold) ||
    input.threshold < 0.5 || input.threshold > 4 || Math.abs(input.threshold * 1000 - Math.round(input.threshold * 1000)) > 1e-8) {
    throw new Error("Anna polttoainelaji ja hintaraja väliltä 0,500–4,000 €/l (enintään 3 desimaalia).");
  }
  const s = input.station;
  if (!s || !["node", "way", "relation"].includes(s.osmType) || !Number.isSafeInteger(s.osmId) || s.osmId < 1 ||
    typeof s.name !== "string" || s.name.length < 1 || s.name.length > 160 ||
    typeof s.brand !== "string" || s.brand.length > 160 || typeof s.address !== "string" || s.address.length > 500 ||
    !Number.isFinite(s.lat) || s.lat < 59 || s.lat > 71 || !Number.isFinite(s.lng) || s.lng < 19 || s.lng > 32) throw new Error("Valitse oikea suomalainen lähiasema.");
  return { station: s, fuel: input.fuel, threshold: input.threshold, subscription: validateSubscription(input.subscription) };
}
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
