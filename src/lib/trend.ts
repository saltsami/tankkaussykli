import type { NearbyHistoryRow, PricePoint } from "./types";

export type TankSignal = {
  state: "cheap" | "neutral" | "wait" | "collecting";
  title: string;
  detail: string;
};

function median(values: number[]) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return Number.NaN;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: number[], fraction: number) {
  const sorted = [...values].sort((first, second) => first - second);
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function parseDay(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("fi-FI", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    timeZone: "Europe/Helsinki",
  })
    .format(date)
    .replace(/\.$/, "");
}

function forecastFromObserved(observed: PricePoint[]) {
  const dated = observed.filter((point) => point.observedAt);
  if (dated.length < 14) return [];

  const weekdayPrices = new Map<number, number[]>();
  for (const point of dated) {
    const weekday = parseDay(point.observedAt!).getUTCDay();
    const bucket = weekdayPrices.get(weekday) ?? [];
    bucket.push(point.price);
    weekdayPrices.set(weekday, bucket);
  }

  const allMedian = median(dated.map((point) => point.price));
  const lastDate = parseDay(dated[dated.length - 1].observedAt!);

  return Array.from({ length: 3 }, (_, index): PricePoint => {
    const date = new Date(lastDate);
    date.setUTCDate(date.getUTCDate() + index + 1);
    const weekdayValues = weekdayPrices.get(date.getUTCDay()) ?? [];
    return {
      label: formatDay(date),
      price: Number(median(weekdayValues.length >= 2 ? weekdayValues : [allMedian]).toFixed(3)),
      forecast: true,
      observedAt: date.toISOString(),
    };
  });
}

export function buildPriceSeries(rows: NearbyHistoryRow[]) {
  const observed = [...rows]
    .sort(
      (first, second) =>
        parseDay(first.observed_day).getTime() - parseDay(second.observed_day).getTime(),
    )
    .slice(-56)
    .map<PricePoint>((row) => ({
      label: formatDay(parseDay(row.observed_day)),
      price: Number(row.median_price),
      observedAt: row.observed_day,
      sampleCount: Number(row.observation_count),
    }));

  return [...observed, ...forecastFromObserved(observed)];
}

export function upsertObservedPrice(
  points: PricePoint[],
  price: number,
  observedAt: string,
) {
  const day = observedAt.slice(0, 10);
  const observed = points.filter((point) => !point.forecast);
  const sameDayIndex = observed.findIndex(
    (point) => point.observedAt?.slice(0, 10) === day,
  );
  const nextPoint: PricePoint = {
    label: formatDay(parseDay(day)),
    price,
    observedAt: day,
    sampleCount: 1,
  };

  if (sameDayIndex >= 0) observed[sameDayIndex] = nextPoint;
  else observed.push(nextPoint);

  observed.sort(
    (first, second) =>
      parseDay(first.observedAt ?? "1970-01-01").getTime() -
      parseDay(second.observedAt ?? "1970-01-01").getTime(),
  );
  const recent = observed.slice(-56);
  return [...recent, ...forecastFromObserved(recent)];
}

export function getTankSignal(points: PricePoint[], currentPrice?: number): TankSignal {
  const observedPrices = points
    .filter((point) => !point.forecast)
    .map((point) => point.price)
    .filter(Number.isFinite);

  if (!currentPrice || observedPrices.length < 4) {
    return {
      state: "collecting",
      title: "Kerätään hintahistoriaa",
      detail: "Signaali tarkentuu, kun asemalta kertyy vähintään neljä hintapäivää.",
    };
  }

  const cheapLimit = quantile(observedPrices, 0.25);
  const expensiveLimit = quantile(observedPrices, 0.7);
  const forecastPrices = points.filter((point) => point.forecast).map((point) => point.price);
  const forecastMinimum = forecastPrices.length ? Math.min(...forecastPrices) : null;

  if (forecastMinimum !== null && forecastMinimum <= currentPrice - 0.025) {
    return {
      state: "wait",
      title: "Kannattaa vielä odottaa",
      detail: `Viikonpäiväarvio käy noin ${Math.round((currentPrice - forecastMinimum) * 100)} snt/l nykyhintaa alempana.`,
    };
  }

  if (currentPrice <= cheapLimit + 0.005) {
    return {
      state: "cheap",
      title: "Halpa hetki on aktiivinen",
      detail: "Nykyhinta kuuluu aseman viime viikkojen edullisimpaan neljännekseen.",
    };
  }

  if (currentPrice >= expensiveLimit) {
    return {
      state: "wait",
      title: "Hinta on tavanomaista korkeampi",
      detail: "Nykyhinta on aseman oman lähihistorian kalliimmassa päässä.",
    };
  }

  return {
    state: "neutral",
    title: "Hinta on normaalialueella",
    detail: "Tankkaa tarpeen mukaan tai seuraa seuraavaa halvempaa havaintoa.",
  };
}
