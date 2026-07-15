import type { Coordinates, Station } from "./types";

const EARTH_RADIUS_KM = 6371;

export function distanceInKm(
  from: Pick<Coordinates, "lat" | "lng">,
  to: Pick<Coordinates, "lat" | "lng">,
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const fromLatitude = toRadians(from.lat);
  const toLatitude = toRadians(to.lat);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function withDistances(stations: Station[], home: Coordinates) {
  return stations
    .map((station) => ({
      ...station,
      distanceKm: distanceInKm(home, station),
    }))
    .sort((first, second) => first.distanceKm - second.distanceKm);
}

export function formatDistance(distanceKm: number) {
  if (distanceKm < 1) {
    return `${Math.max(50, Math.round((distanceKm * 1000) / 50) * 50)} m`;
  }

  return `${distanceKm.toLocaleString("fi-FI", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} km`;
}
