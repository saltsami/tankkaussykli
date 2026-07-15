"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { Coordinates, FuelType, Station } from "@/lib/types";

type StationMapProps = {
  home: Coordinates;
  stations: Station[];
  fuel: FuelType;
  selectedId?: string;
  onSelect: (station: Station) => void;
};

function RecenterMap({ home }: { home: Coordinates }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo([home.lat, home.lng], 11, { duration: 0.7 });
  }, [home, map]);

  return null;
}

function stationIcon(price: number | undefined, selected: boolean) {
  const label = price ? price.toFixed(3) : "–";
  return L.divIcon({
    className: "fuel-marker-shell",
    html: `<span class="fuel-marker${selected ? " fuel-marker-selected" : ""}">${label}</span>`,
    iconSize: [62, 34],
    iconAnchor: [31, 17],
    popupAnchor: [0, -20],
  });
}

function homeIcon() {
  return L.divIcon({
    className: "home-marker-shell",
    html: '<span class="home-marker"><span></span></span>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export default function StationMap({
  home,
  stations,
  fuel,
  selectedId,
  onSelect,
}: StationMapProps) {
  const tileUrl =
    process.env.NEXT_PUBLIC_MAP_TILE_URL ??
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution =
    process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const icons = useMemo(
    () =>
      new Map(
        stations.map((station) => [
          station.id,
          stationIcon(station.prices[fuel]?.price, station.id === selectedId),
        ]),
      ),
    [fuel, selectedId, stations],
  );

  return (
    <MapContainer
      center={[home.lat, home.lng]}
      zoom={11}
      scrollWheelZoom
      className="station-map"
      aria-label="Kartta lähialueen polttoaineasemista"
    >
      <TileLayer url={tileUrl} attribution={attribution} maxZoom={19} />
      <RecenterMap home={home} />
      <Marker position={[home.lat, home.lng]} icon={homeIcon()}>
        <Popup>Kotipaikka: {home.label}</Popup>
      </Marker>
      {stations.map((station) => (
        <Marker
          key={station.id}
          position={[station.lat, station.lng]}
          icon={icons.get(station.id)!}
          eventHandlers={{ click: () => onSelect(station) }}
        >
          <Popup>
            <strong>{station.name}</strong>
            <br />
            {station.prices[fuel]
              ? `${station.prices[fuel]!.price.toFixed(3)} €/l`
              : "Ei tuoretta hintaa"}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
