import { NextResponse } from "next/server";
import webpush from "web-push";
import { adminClient, alertConfig } from "@/lib/server/alert-config";
import { validCronAuthorization } from "@/lib/price-alert-policy";
import { runPriceAlerts } from "@/lib/price-alert-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!validCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  try {
    const config = alertConfig();
    if (!config) return NextResponse.json({ error: "Push configuration missing" }, { status: 503, headers });
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    const result = await runPriceAlerts(adminClient(config), (subscription, payload, options) => webpush.sendNotification(subscription, payload, options), config.maxAgeHours);
    return NextResponse.json(result, { headers });
  } catch {
    console.error("price-alerts cron failed");
    return NextResponse.json({ error: "Price alert job failed" }, { status: 500, headers });
  }
}
