"use client";

import { generatedHistory } from "./demo-data";
import { distanceInKm } from "./geo";
import { getSupabaseBrowserClient } from "./supabase";
import type {
  Coordinates,
  FuelType,
  NearbyPriceRow,
  Station,
} from "./types";

type OsmStation = Omit<Station, "distanceKm" | "prices" | "history">;

export async function discoverStations(home: Coordinates) {
  const parameters = new URLSearchParams({
    lat: home.lat.toString(),
    lng: home.lng.toString(),
    radius: "25",
  });
  const response = await fetch(`/api/stations?${parameters.toString()}`);

  if (!response.ok) {
    throw new Error("Lähiasemia ei saatu karttapalvelusta.");
  }

  const payload = (await response.json()) as { stations: OsmStation[] };
  return payload.stations.map<Station>((station) => ({
    ...station,
    distanceKm: distanceInKm(home, station),
    prices: {},
    history: {},
  }));
}

export async function enrichWithSupabasePrices(
  stations: Station[],
  home: Coordinates,
  fuel: FuelType,
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return stations;

  const { data, error } = await supabase.rpc(
    "nearby_stations_with_latest_prices",
    {
      p_lat: home.lat,
      p_lng: home.lng,
      p_radius_km: 30,
      p_fuel_type: fuel,
    },
  );

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as NearbyPriceRow[];
  const indexedRows = new Map(
    rows.map((row) => [`${row.osm_type}-${row.osm_id}`, row]),
  );

  return stations.map((station) => {
    if (!station.osmId || station.osmType === "demo") return station;

    const row = indexedRows.get(`${station.osmType}-${station.osmId}`);
    if (!row?.latest_price || !row.observed_at) return station;

    return {
      ...station,
      databaseId: row.station_id,
      prices: {
        ...station.prices,
        [fuel]: {
          price: Number(row.latest_price),
          observedAt: row.observed_at,
          sampleCount: row.sample_count ?? undefined,
        },
      },
      history: {
        ...station.history,
        [fuel]: generatedHistory(Number(row.latest_price)),
      },
    };
  });
}

export async function submitPriceObservation(
  station: Station,
  fuel: FuelType,
  price: number,
) {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return { mode: "demo" as const, observedAt: new Date().toISOString() };
  }

  if (station.osmType === "demo" || !station.osmId) {
    throw new Error("Valitse ensin oikea lähiasema kartalta.");
  }

  const { data: sessionData } = await supabase.auth.getSession();
  let userId = sessionData.session?.user.id;

  if (!userId) {
    const { data: signInData, error: signInError } =
      await supabase.auth.signInAnonymously();
    if (signInError) throw signInError;
    userId = signInData.user?.id;
  }

  if (!userId) {
    throw new Error("Anonyymin käyttäjän luonti epäonnistui.");
  }

  const { data: stationRow, error: stationError } = await supabase
    .from("stations")
    .upsert(
      {
        osm_type: station.osmType,
        osm_id: station.osmId,
        name: station.name,
        brand: station.brand,
        address: station.address,
        latitude: station.lat,
        longitude: station.lng,
      },
      { onConflict: "osm_type,osm_id" },
    )
    .select("id")
    .single();

  if (stationError) throw stationError;

  const observedAt = new Date().toISOString();
  const { error: observationError } = await supabase
    .from("price_observations")
    .insert({
      station_id: stationRow.id,
      fuel_type: fuel,
      price_eur: price,
      observed_at: observedAt,
      reporter_id: userId,
    });

  if (observationError) throw observationError;

  return { mode: "supabase" as const, observedAt };
}
