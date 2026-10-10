export const FUEL_TYPES = ["95E10", "98E5", "DIESEL"] as const;

export type FuelType = (typeof FUEL_TYPES)[number];

export type Coordinates = {
  lat: number;
  lng: number;
  label: string;
};

export type PriceSnapshot = {
  price: number;
  observedAt: string;
  sampleCount?: number;
};

export type PricePoint = {
  label: string;
  price: number;
  forecast?: boolean;
  observedAt?: string;
  sampleCount?: number;
};

export type Station = {
  id: string;
  databaseId?: string;
  osmType: "node" | "way" | "relation" | "demo";
  osmId?: number;
  name: string;
  brand: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number;
  isDemo?: boolean;
  prices: Partial<Record<FuelType, PriceSnapshot>>;
  history: Partial<Record<FuelType, PricePoint[]>>;
};

export type GeocodeResult = {
  id: string;
  label: string;
  shortLabel: string;
  lat: number;
  lng: number;
};

export type NearbyPriceRow = {
  station_id: string;
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  latest_price: number | null;
  observed_at: string | null;
  sample_count: number | null;
};

export type NearbyHistoryRow = {
  station_id: string;
  observed_day: string;
  median_price: number;
  observation_count: number;
};

export type PriceAlertRule = {
  id: string;
  stationId: string;
  stationName: string;
  fuel: FuelType;
  threshold: number;
  delivery?: "local" | "push";
  serverRuleId?: string;
  pushEnabled?: boolean;
};
