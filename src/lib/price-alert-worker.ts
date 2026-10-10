import { validateSubscription } from "./price-alert-policy.ts";
export type Delivery = {
  delivery_id: string; lease_token: string; attempts: number;
  endpoint: string; p256dh: string; auth: string;
  station_name: string; osm_type: string; osm_id: number; fuel_type: string;
  price_eur: number; observed_at: string; expires_at: string;
};
type RpcClient = { rpc(name: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type SendPush = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string,
  options: { TTL: number; timeout: number }) => Promise<unknown>;
export async function runPriceAlerts(db: RpcClient, send: SendPush, maxAgeHours: number, now = () => Date.now()) {
  const queued = await db.rpc("enqueue_price_alerts", { p_max_age_hours: maxAgeHours });
  if (queued.error) throw queued.error;
  const batch = await db.rpc("claim_price_alert_deliveries", { p_limit: 20, p_max_age_hours: maxAgeHours });
  if (batch.error) throw batch.error;
  const jobs = (batch.data ?? []) as Delivery[];
  const result = { queued: Number(queued.data ?? 0), claimed: jobs.length, sent: 0, retry: 0, gone: 0, obsolete: 0 };
  // Five sends at a time; 20 jobs, 8s HTTP timeout, 2min database lease.
  for (let start = 0; start < jobs.length; start += 5) {
    await Promise.all(jobs.slice(start, start + 5).map(async (job) => {
      let outcome: "sent" | "retry" | "gone" = "sent";
      let errorMessage: string | null = null;
      try {
        const seconds = Math.floor((Date.parse(job.expires_at) - now()) / 1000);
        if (seconds <= 0) throw new Error("Expired before send");
        const subscription = validateSubscription({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } });
        await send(subscription, JSON.stringify({ title: "Hintavahti: hintaraja täyttyi",
          body: `${job.station_name} · ${job.fuel_type} ${Number(job.price_eur).toFixed(3)} €/l. Havainto ${new Date(job.observed_at).toLocaleString("fi-FI", { timeZone: "Europe/Helsinki" })}.`,
          tag: `price-alert-${job.delivery_id}`, observedAt: job.observed_at, expiresAt: job.expires_at,
          url: `/?station=${encodeURIComponent(`${job.osm_type}-${job.osm_id}`)}&fuel=${encodeURIComponent(job.fuel_type)}`,
        }), { TTL: Math.min(3600, seconds), timeout: 8000 });
      } catch (reason) {
        const code = (reason as { statusCode?: number } | null)?.statusCode;
        outcome = code === 404 || code === 410 ? "gone" : "retry";
        // Do not store/log provider responses, endpoints, auth secrets or payloads.
        errorMessage = code ? `Push HTTP ${code}` : "Push delivery failed";
      }
      const finished = await db.rpc("finish_price_alert_delivery", {
        p_id: job.delivery_id, p_token: job.lease_token, p_result: outcome, p_error: errorMessage,
      });
      if (finished.error) throw finished.error;
      if (finished.data === true) result[outcome]++; else result.obsolete++;
    }));
  }
  return result;
}
