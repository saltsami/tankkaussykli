import { NextResponse } from "next/server";
import { adminClient, alertConfig, authenticatedUser, readJson } from "@/lib/server/alert-config";
import { isUuid, validateAlertInput } from "@/lib/price-alert-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

async function handle(request: Request) {
  const config = alertConfig();
  if (request.method === "GET" && new URL(request.url).searchParams.has("config")) {
    return json({ enabled: !!config, publicKey: config?.publicKey, maxAgeHours: config?.maxAgeHours ?? 24 });
  }
  if (!config) return json({ error: "Taustavahti ei ole vielä käytössä. Ylläpitäjän on määritettävä Push ja ajastus." }, 503);
  if (request.method !== "GET" && request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Virheellinen alkuperä." }, 403);
  const user = await authenticatedUser(request, config);
  if (!user) return json({ error: "Kirjautuminen puuttuu tai on vanhentunut." }, 401);
  const db = adminClient(config);
  if (request.method === "GET") {
    const { data, error } = await db.from("price_alert_rules").select("id, fuel_type, threshold, stations!inner(osm_type, osm_id, name), push_subscriptions!inner(enabled)").eq("user_id", user.id);
    if (error) throw error;
    const rules = (data ?? []).map((row) => {
      const station = row.stations as unknown as { osm_type: string; osm_id: number; name: string };
      const subscription = row.push_subscriptions as unknown as { enabled: boolean };
      const stationId = `${station.osm_type}-${station.osm_id}`;
      return { id: `${stationId}:${row.fuel_type}`, stationId, stationName: station.name, fuel: row.fuel_type,
        threshold: Number(row.threshold), serverRuleId: row.id, delivery: "push", pushEnabled: subscription.enabled };
    });
    return json({ rules });
  }
  let body: unknown;
  try { body = await readJson(request); } catch { return json({ error: "Virheellinen tai liian suuri lomake." }, 400); }
  if (request.method === "DELETE") {
    const id = (body as { id?: unknown } | null)?.id;
    if (!isUuid(id)) return json({ error: "Virheellinen hintavahdin tunniste." }, 400);
    const { error } = await db.from("price_alert_rules").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return json({ deleted: true });
  }
  let input;
  try { input = validateAlertInput(body); } catch (reason) { return json({ error: reason instanceof Error ? reason.message : "Virheellinen lomake." }, 400); }
  const s = input.station;
  const { error: insertError } = await db.from("stations").upsert({ osm_type: s.osmType, osm_id: s.osmId, name: s.name,
    brand: s.brand, address: s.address, latitude: s.lat, longitude: s.lng }, { onConflict: "osm_type,osm_id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { data: station, error: stationError } = await db.from("stations").select("id").eq("osm_type", s.osmType).eq("osm_id", s.osmId).single();
  if (stationError) throw stationError;
  const { data: ruleId, error } = await db.rpc("save_price_alert", { p_user_id: user.id, p_station_id: station.id,
    p_fuel: input.fuel, p_threshold: input.threshold, p_endpoint: input.subscription.endpoint,
    p_p256dh: input.subscription.keys.p256dh, p_auth: input.subscription.keys.auth });
  if (error) {
    if (error.message.includes("limit reached")) return json({ error: "Hintavahtien tai laitteiden enimmäismäärä saavutettu." }, 409);
    if (error.message.includes("another user")) return json({ error: "Push-tilaus kuuluu aiempaan käyttäjäistuntoon. Poista selaimen Push-tilaus ja yritä uudelleen." }, 409);
    throw error;
  }
  return json({ ruleId });
}
async function safeHandle(request: Request) {
  try { return await handle(request); } catch { console.error("price-alerts API failed"); return json({ error: "Hintavahdin palvelu ei vastannut. Yritä uudelleen." }, 500); }
}
export const GET = safeHandle;
export const PUT = safeHandle;
export const DELETE = safeHandle;
