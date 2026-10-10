"use client";
import { getSupabaseBrowserClient } from "./supabase";
import type { FuelType, PriceAlertRule, Station } from "./types";

export async function backgroundAlertConfig() {
  const response = await fetch("/api/price-alerts?config", { cache: "no-store" });
  if (!response.ok) throw new Error("Taustavahdin asetuksia ei saatu.");
  return await response.json() as { enabled: boolean; publicKey?: string; maxAgeHours: number };
}
async function authToken(create: boolean) {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Yhdistä Supabase taustavahtia varten.");
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (data.session) return data.session.access_token;
  if (!create) return null;
  const signed = await client.auth.signInAnonymously();
  if (signed.error) throw signed.error;
  if (!signed.data.session) throw new Error("Anonyymin käyttäjän luonti epäonnistui.");
  return signed.data.session.access_token;
}
async function request(method: string, token: string, body?: unknown) {
  const response = await fetch("/api/price-alerts", { method, cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Hintavahdin tallennus epäonnistui.");
  return result;
}
export async function loadBackgroundAlerts() {
  const config = await backgroundAlertConfig();
  if (!config.enabled) return null;
  const token = await authToken(false);
  if (!token) return null;
  return (await request("GET", token)).rules as PriceAlertRule[];
}
export async function saveBackgroundAlert(station: Station, fuel: FuelType, threshold: number) {
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("Taustailmoitukset eivät ole tässä selaimessa käytettävissä. iPhonessa avaa kotinäytölle asennettu PWA.");
  }
  if (station.isDemo || station.osmType === "demo") throw new Error("Esimerkkiasemalle ei voi asettaa taustavahtia.");
  // Request from the user gesture before any network roundtrips (Safari).
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Salli ilmoitukset selaimen asetuksista tai valitse paikallinen vahti.");
  const config = await backgroundAlertConfig();
  if (!config.enabled || !config.publicKey) throw new Error("Taustavahti odottaa ylläpitäjän Push- ja ajastusasetuksia. Paikallinen vahti on käytettävissä.");
  const token = await authToken(true);
  if (!token) throw new Error("Kirjautuminen epäonnistui.");
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  const publicKey = Uint8Array.from(atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  // Handle deployment VAPID-key rotation on the next explicit save.
  if (subscription) {
    const existing = subscription.options.applicationServerKey;
    if (existing && Array.from(new Uint8Array(existing)).join(",") !== Array.from(publicKey).join(",")) {
      await subscription.unsubscribe(); subscription = null;
    }
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  const result = await request("PUT", token, { station: { osmType: station.osmType, osmId: station.osmId, name: station.name,
    brand: station.brand, address: station.address, lat: station.lat, lng: station.lng }, fuel, threshold, subscription: subscription.toJSON() });
  return result.ruleId as string;
}
export async function deleteBackgroundAlert(id: string) {
  const token = await authToken(false);
  if (!token) throw new Error("Aiempi käyttäjäistunto puuttuu. Taustavahtia ei voitu poistaa.");
  await request("DELETE", token, { id });
}
