import type { Coordinates, FuelType, PricePoint, Station } from "./types";

export const DEFAULT_HOME: Coordinates = {
  lat: 60.192059,
  lng: 24.945831,
  label: "Helsinki",
};

const now = Date.now();

function observed(hoursAgo: number) {
  return new Date(now - hoursAgo * 60 * 60 * 1000).toISOString();
}

function history(base: number): PricePoint[] {
  return [
    { label: "Ma", price: base + 0.052 },
    { label: "Ti", price: base + 0.041 },
    { label: "Ke", price: base + 0.083 },
    { label: "To", price: base + 0.061 },
    { label: "Pe", price: base + 0.039 },
    { label: "La", price: base + 0.025 },
    { label: "Su", price: base + 0.014 },
    { label: "Ma", price: base + 0.008 },
    { label: "Ti", price: base },
    { label: "Ke", price: base + 0.041, forecast: true },
    { label: "To", price: base + 0.029, forecast: true },
    { label: "Pe", price: base + 0.018, forecast: true },
  ];
}

function prices(
  petrol95: number,
  petrol98: number,
  diesel: number,
  hoursAgo: number,
): Station["prices"] {
  return {
    "95E10": { price: petrol95, observedAt: observed(hoursAgo), sampleCount: 5 },
    "98E5": { price: petrol98, observedAt: observed(hoursAgo), sampleCount: 3 },
    DIESEL: { price: diesel, observedAt: observed(hoursAgo), sampleCount: 4 },
  };
}

function histories(
  petrol95: number,
  petrol98: number,
  diesel: number,
): Partial<Record<FuelType, PricePoint[]>> {
  return {
    "95E10": history(petrol95),
    "98E5": history(petrol98),
    DIESEL: history(diesel),
  };
}

export const DEMO_STATIONS: Station[] = [
  {
    id: "demo-konala",
    osmType: "demo",
    name: "Neste Konala",
    brand: "Neste",
    address: "Konalantie 47, Helsinki",
    lat: 60.24189,
    lng: 24.84695,
    distanceKm: 0,
    isDemo: true,
    prices: prices(1.789, 1.889, 1.729, 0.2),
    history: histories(1.789, 1.889, 1.729),
  },
  {
    id: "demo-pasila",
    osmType: "demo",
    name: "ABC Pasila",
    brand: "ABC",
    address: "Hakamäentie 1, Helsinki",
    lat: 60.20349,
    lng: 24.93352,
    distanceKm: 0,
    isDemo: true,
    prices: prices(1.804, 1.909, 1.744, 0.6),
    history: histories(1.804, 1.909, 1.744),
  },
  {
    id: "demo-malmi",
    osmType: "demo",
    name: "St1 Malmi",
    brand: "St1",
    address: "Lahdenväylä, Helsinki",
    lat: 60.25134,
    lng: 25.01241,
    distanceKm: 0,
    isDemo: true,
    prices: prices(1.812, 1.922, 1.759, 1.4),
    history: histories(1.812, 1.922, 1.759),
  },
  {
    id: "demo-myyrmaki",
    osmType: "demo",
    name: "Teboil Myyrmäki",
    brand: "Teboil",
    address: "Raappavuorentie, Vantaa",
    lat: 60.2678,
    lng: 24.8512,
    distanceKm: 0,
    isDemo: true,
    prices: prices(1.795, 1.899, 1.735, 2.1),
    history: histories(1.795, 1.899, 1.735),
  },
];

export function demoStationsFor(home: Coordinates) {
  if (home.label === DEFAULT_HOME.label) return DEMO_STATIONS;

  const latitudeDelta = home.lat - DEFAULT_HOME.lat;
  const longitudeDelta = home.lng - DEFAULT_HOME.lng;
  return DEMO_STATIONS.map((station) => ({
    ...station,
    name: `${station.brand} ${home.label}`,
    address: `Esimerkkiasema · ${home.label}`,
    lat: station.lat + latitudeDelta,
    lng: station.lng + longitudeDelta,
  }));
}

export function generatedHistory(price: number): PricePoint[] {
  return history(price);
}
