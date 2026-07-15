"use client";

import { useState } from "react";
import { Crosshair, LoaderCircle, MapPin, Search, X } from "lucide-react";
import type { Coordinates, GeocodeResult } from "@/lib/types";

type LocationSheetProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (location: Coordinates) => void;
  onUseCurrentLocation: () => Promise<void>;
  locating: boolean;
};

export function LocationSheet({
  open,
  onClose,
  onSelect,
  onUseCurrentLocation,
  locating,
}: LocationSheetProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    setSearching(true);
    setError("");
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
      if (!response.ok) throw new Error("Hakua ei voitu tehdä juuri nyt.");
      const payload = (await response.json()) as { results: GeocodeResult[] };
      setResults(payload.results);
      if (!payload.results.length) setError("Paikkaa ei löytynyt Suomesta.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Paikkahaku epäonnistui.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-sheet-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">Oma alue</p>
            <h2 id="location-sheet-title">Valitse kotipaikka</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Sulje">
            <X aria-hidden="true" />
          </button>
        </div>

        <button
          className="primary-button full-width"
          type="button"
          onClick={onUseCurrentLocation}
          disabled={locating}
        >
          {locating ? <LoaderCircle className="spin" aria-hidden="true" /> : <Crosshair aria-hidden="true" />}
          {locating ? "Paikannetaan…" : "Käytä nykyistä sijaintia"}
        </button>

        <div className="sheet-divider"><span>tai hae paikka</span></div>

        <form className="search-form" onSubmit={search}>
          <label htmlFor="place-search">Kaupunki, alue tai osoite</label>
          <div className="search-field">
            <Search aria-hidden="true" />
            <input
              id="place-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Esim. Tampere tai Kaleva"
              autoComplete="street-address"
            />
            <button type="submit" disabled={searching || query.trim().length < 2}>
              {searching ? "Haetaan…" : "Hae"}
            </button>
          </div>
        </form>

        {error && <p className="form-message error-message">{error}</p>}

        {results.length > 0 && (
          <ul className="location-results">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect({ lat: result.lat, lng: result.lng, label: result.shortLabel });
                    onClose();
                  }}
                >
                  <MapPin aria-hidden="true" />
                  <span><strong>{result.shortLabel}</strong><small>{result.label}</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="sheet-note">Kotipaikka tallennetaan vain tähän selaimeen.</p>
      </section>
    </div>
  );
}
