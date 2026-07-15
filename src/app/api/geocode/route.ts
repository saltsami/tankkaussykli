import { NextRequest, NextResponse } from "next/server";

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    municipality?: string;
    village?: string;
    suburb?: string;
  };
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query || query.length < 2 || query.length > 80) {
    return NextResponse.json(
      { error: "Anna vähintään kaksi merkkiä sisältävä paikannimi." },
      { status: 400 },
    );
  }

  const baseUrl =
    process.env.NOMINATIM_API_URL ?? "https://nominatim.openstreetmap.org";
  const parameters = new URLSearchParams({
    q: query,
    format: "jsonv2",
    countrycodes: "fi",
    addressdetails: "1",
    limit: "5",
    "accept-language": "fi",
  });

  if (process.env.NOMINATIM_EMAIL) {
    parameters.set("email", process.env.NOMINATIM_EMAIL);
  }

  try {
    const response = await fetch(`${baseUrl}/search?${parameters.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TankkausSykli/0.1 (location search)",
      },
      next: { revalidate: 60 * 60 * 24 * 30 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Paikkahaku ei vastannut. Kokeile hetken kuluttua." },
        { status: 502 },
      );
    }

    const results = (await response.json()) as NominatimResult[];
    return NextResponse.json(
      {
        results: results.map((result) => ({
          id: result.place_id.toString(),
          label: result.display_name,
          shortLabel:
            result.name ??
            result.address?.city ??
            result.address?.town ??
            result.address?.municipality ??
            result.address?.village ??
            result.address?.suburb ??
            query,
          lat: Number(result.lat),
          lng: Number(result.lon),
        })),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=86400",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Paikkahaku ei ole juuri nyt käytettävissä." },
      { status: 503 },
    );
  }
}
