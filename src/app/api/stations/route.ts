import { NextRequest, NextResponse } from "next/server";

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function numberParameter(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function addressFromTags(tags: Record<string, string>) {
  const street = [tags["addr:street"], tags["addr:housenumber"]]
    .filter(Boolean)
    .join(" ");
  const city =
    tags["addr:city"] ?? tags["addr:municipality"] ?? tags["addr:suburb"];
  return [street, city].filter(Boolean).join(", ") || "Osoite ei tiedossa";
}

export async function GET(request: NextRequest) {
  const lat = numberParameter(request.nextUrl.searchParams.get("lat"), NaN);
  const lng = numberParameter(request.nextUrl.searchParams.get("lng"), NaN);
  const radiusKm = Math.min(
    40,
    Math.max(2, numberParameter(request.nextUrl.searchParams.get("radius"), 25)),
  );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < 59 ||
    lat > 71 ||
    lng < 19 ||
    lng > 32
  ) {
    return NextResponse.json(
      { error: "Koordinaattien pitää olla Suomessa." },
      { status: 400 },
    );
  }

  const radiusMeters = Math.round(radiusKm * 1000);
  const query = `[out:json][timeout:12];(
    node["amenity"="fuel"](around:${radiusMeters},${lat},${lng});
    way["amenity"="fuel"](around:${radiusMeters},${lat},${lng});
    relation["amenity"="fuel"](around:${radiusMeters},${lat},${lng});
  );out center tags 100;`;
  const endpoint =
    process.env.OVERPASS_API_URL ??
    "https://overpass-api.de/api/interpreter";

  try {
    const response = await fetch(
      `${endpoint}?data=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "TankkausSykli/0.1 (nearby fuel stations)",
        },
        next: { revalidate: 60 * 60 * 6 },
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Asemakartta ei vastannut." },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as { elements?: OsmElement[] };
    const stations = (payload.elements ?? [])
      .map((element) => {
        const stationLat = element.lat ?? element.center?.lat;
        const stationLng = element.lon ?? element.center?.lon;
        if (stationLat === undefined || stationLng === undefined) return null;

        const tags = element.tags ?? {};
        const brand = tags.brand ?? tags.operator ?? "Huoltoasema";
        return {
          id: `osm-${element.type}-${element.id}`,
          osmType: element.type,
          osmId: element.id,
          name: tags.name ?? tags.brand ?? tags.operator ?? "Huoltoasema",
          brand,
          address: addressFromTags(tags),
          lat: stationLat,
          lng: stationLng,
        };
      })
      .filter((station) => station !== null);

    return NextResponse.json(
      { stations },
      {
        headers: {
          "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Lähiasemia ei saatu juuri nyt karttapalvelusta." },
      { status: 503 },
    );
  }
}
