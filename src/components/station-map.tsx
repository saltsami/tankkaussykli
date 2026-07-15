"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Coordinates, FuelType, Station } from "@/lib/types";

type StationMapProps = {
  home: Coordinates;
  stations: Station[];
  fuel: FuelType;
  selectedId?: string;
  onSelect: (station: Station) => void;
};

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

function stationPopup(station: Station, fuel: FuelType) {
  const container = document.createElement("div");
  const name = document.createElement("strong");
  const price = document.createElement("span");
  name.textContent = station.name;
  price.textContent = station.prices[fuel]
    ? `${station.prices[fuel]!.price.toFixed(3)} €/l`
    : "Ei tuoretta hintaa";
  container.append(name, document.createElement("br"), price);
  return container;
}

function homePopup(label: string) {
  const container = document.createElement("span");
  container.textContent = `Kotipaikka: ${label}`;
  return container;
}

export default function StationMap({
  home,
  stations,
  fuel,
  selectedId,
  onSelect,
}: StationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, { scrollWheelZoom: true }).setView(
      [home.lat, home.lng],
      11,
    );
    const tileUrl =
      process.env.NEXT_PUBLIC_MAP_TILE_URL ??
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    const attribution =
      process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

    L.tileLayer(tileUrl, { attribution, maxZoom: 19 }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      markerLayerRef.current = null;
      mapRef.current = null;
      map.remove();
      delete (container as HTMLDivElement & { _leaflet_id?: number })._leaflet_id;
    };
    // Kartta alustetaan vain konttia varten; koti ja asemat päivitetään alla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    map.setView([home.lat, home.lng], 11, { animate: false });

    L.marker([home.lat, home.lng], {
      icon: homeIcon(),
      keyboard: true,
      title: `Kotipaikka: ${home.label}`,
    })
      .bindPopup(homePopup(home.label))
      .addTo(layer);

    for (const station of stations) {
      const marker = L.marker([station.lat, station.lng], {
        icon: stationIcon(station.prices[fuel]?.price, station.id === selectedId),
        keyboard: true,
        title: station.name,
      });
      marker.bindPopup(stationPopup(station, fuel));
      marker.on("click", () => onSelectRef.current(station));
      marker.addTo(layer);
    }
  }, [fuel, home, selectedId, stations]);

  return (
    <div
      ref={containerRef}
      className="station-map"
      role="region"
      aria-label="Kartta lähialueen polttoaineasemista"
    />
  );
}
