import assert from "node:assert/strict";
import test from "node:test";
import type { NearbyHistoryRow, PricePoint } from "./types.ts";
import { buildPriceSeries, getTankSignal, upsertObservedPrice } from "./trend.ts";

test("buildPriceSeries adds a three-day weekday forecast after enough history", () => {
  const rows: NearbyHistoryRow[] = Array.from({ length: 21 }, (_, index) => ({
    station_id: "station-1",
    observed_day: new Date(Date.UTC(2026, 5, index + 1)).toISOString().slice(0, 10),
    median_price: 1.7 + (index % 7) * 0.01,
    observation_count: 2,
  }));

  const series = buildPriceSeries(rows);
  assert.equal(series.filter((point) => point.forecast).length, 3);
  assert.equal(series.filter((point) => !point.forecast).length, 21);
});

test("getTankSignal identifies a price in the cheapest quartile", () => {
  const points: PricePoint[] = [1.7, 1.72, 1.74, 1.76, 1.78].map((price) => ({
    label: "päivä",
    price,
  }));
  assert.equal(getTankSignal(points, 1.7).state, "cheap");
});

test("getTankSignal recommends waiting for a materially lower forecast", () => {
  const points: PricePoint[] = [1.7, 1.71, 1.72, 1.73].map((price) => ({
    label: "päivä",
    price,
  }));
  points.push({ label: "huomenna", price: 1.66, forecast: true });
  assert.equal(getTankSignal(points, 1.7).state, "wait");
});

test("upsertObservedPrice replaces the same day and drops stale forecasts", () => {
  const next = upsertObservedPrice(
    [
      { label: "ma", price: 1.8, observedAt: "2026-07-13" },
      { label: "ti", price: 1.75, observedAt: "2026-07-14" },
      { label: "arvio", price: 1.7, forecast: true, observedAt: "2026-07-15" },
    ],
    1.69,
    "2026-07-14T12:00:00Z",
  );

  assert.equal(next.filter((point) => !point.forecast).length, 2);
  assert.equal(next.find((point) => point.observedAt === "2026-07-14")?.price, 1.69);
  assert.equal(next.some((point) => point.forecast), false);
});
