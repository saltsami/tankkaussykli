"use client";

import { distanceInKm } from "./geo";
import { getSupabaseBrowserClient } from "./supabase";
import { buildPriceSeries } from "./trend";
import type {
  Coordinates,
  FuelType,
  NearbyHistoryRow,
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

  const parameters = {
    p_lat: home.lat,
    p_lng: home.lng,
    p_radius_km: 30,
    p_fuel_type: fuel,
  };
  const [latestResult, historyResult] = await Promise.all([
    supabase.rpc("nearby_stations_with_latest_prices", parameters),
    supabase.rpc("nearby_station_price_history", parameters),
  ]);

  if (latestResult.error) throw latestResult.error;
  if (historyResult.error) throw historyResult.error;

  const rows = (latestResult.data ?? []) as NearbyPriceRow[];
  const historyRows = (historyResult.data ?? []) as NearbyHistoryRow[];
  const indexedRows = new Map(
    rows.map((row) => [`${row.osm_type}-${row.osm_id}`, row]),
  );
  const historyByStation = new Map<string, NearbyHistoryRow[]>();
  for (const historyRow of historyRows) {
    const stationRows = historyByStation.get(historyRow.station_id) ?? [];
    stationRows.push(historyRow);
    historyByStation.set(historyRow.station_id, stationRows);
  }

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
        [fuel]: buildPriceSeries(historyByStation.get(row.station_id) ?? []),
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

  const { data: existingStation, error: lookupError } = await supabase
    .from("stations")
    .select("id")
    .eq("osm_type", station.osmType)
    .eq("osm_id", station.osmId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  let stationId = existingStation?.id as string | undefined;
  if (!stationId) {
    const { data: insertedStation, error: insertError } = await supabase
      .from("stations")
      .insert({
        osm_type: station.osmType,
        osm_id: station.osmId,
        name: station.name,
        brand: station.brand,
        address: station.address,
        latitude: station.lat,
        longitude: station.lng,
      })
      .select("id")
      .single();

    if (insertError?.code === "23505") {
      const { data: racedStation, error: raceLookupError } = await supabase
        .from("stations")
        .select("id")
        .eq("osm_type", station.osmType)
        .eq("osm_id", station.osmId)
        .single();
      if (raceLookupError) throw raceLookupError;
      stationId = racedStation.id;
    } else if (insertError) {
      throw insertError;
    } else {
      stationId = insertedStation.id;
    }
  }

  if (!stationId) throw new Error("Aseman tallennus epäonnistui.");

  const observedAt = new Date().toISOString();
  const { error: observationError } = await supabase
    .from("price_observations")
    .insert({
      station_id: stationId,
      fuel_type: fuel,
      price_eur: price,
      observed_at: observedAt,
      reporter_id: userId,
    });

  if (observationError) throw observationError;

  return { mode: "supabase" as const, observedAt };
}
