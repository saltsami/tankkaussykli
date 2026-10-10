import "server-only";
import { createClient } from "@supabase/supabase-js";
import { maxAgeHours } from "../price-alert-policy";

export function alertConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!url || !publishableKey || !serviceKey || !publicKey || !privateKey || !subject || !process.env.CRON_SECRET) return null;
  return { url, publishableKey, serviceKey, publicKey, privateKey, subject, maxAgeHours: maxAgeHours(process.env.PRICE_ALERT_MAX_AGE_HOURS) };
}
export function adminClient(config: NonNullable<ReturnType<typeof alertConfig>>) {
  return createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function authenticatedUser(request: Request, config: NonNullable<ReturnType<typeof alertConfig>>) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const auth = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(header.slice(7));
  return error ? null : data.user;
}
export async function readJson(request: Request): Promise<unknown> {
  // Limit actual bytes, including chunked requests.
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Puuttuva lomake.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new Error("Lomake on liian suuri."); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
