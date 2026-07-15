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
