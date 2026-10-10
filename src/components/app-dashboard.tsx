"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  ChevronRight,
  Clock3,
  Fuel,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Sparkles,
} from "lucide-react";
import { DEMO_STATIONS, DEFAULT_HOME, demoStationsFor, generatedHistory } from "@/lib/demo-data";
import { formatDistance, withDistances } from "@/lib/geo";
import { discoverStations, enrichWithSupabasePrices } from "@/lib/station-service";
import { deleteBackgroundAlert, loadBackgroundAlerts, saveBackgroundAlert } from "@/lib/price-alert-client";
import { shouldNotifyLocally } from "@/lib/local-alert-policy";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getTankSignal, upsertObservedPrice } from "@/lib/trend";
import {
  FUEL_TYPES,
  type Coordinates,
  type FuelType,
  type PriceAlertRule,
  type Station,
} from "@/lib/types";
import { LocationSheet } from "./location-sheet";
import { PriceAlertSheet } from "./price-alert-sheet";
import { PriceChart } from "./price-chart";
import { ReportPriceSheet } from "./report-price-sheet";

const StationMap = dynamic(() => import("./station-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Karttaa ladataan…</div>,
});

const HOME_STORAGE_KEY = "tankkaussykli.home.v1";
const ALERT_STORAGE_KEY = "tankkaussykli.alerts.v1";

function stationAlertKey(station: Station) {
  return station.isDemo
    ? `${station.id}@${station.lat.toFixed(4)},${station.lng.toFixed(4)}`
    : station.id;
}

function formatFreshness(isoDate?: string) {
  if (!isoDate) return "Ei hintahavaintoa";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(isoDate).getTime()) / 60000));
  if (minutes < 2) return "juuri nyt";
  if (minutes < 60) return `${minutes} min sitten`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h sitten`;
  return `${Math.round(hours / 24)} vrk sitten`;
}

function priceFor(station: Station, fuel: FuelType) {
  return station.prices[fuel]?.price ?? Number.POSITIVE_INFINITY;
}

export function AppDashboard() {
  const [home, setHome] = useState<Coordinates>(DEFAULT_HOME);
  const [fuel, setFuel] = useState<FuelType>("95E10");
  const [stations, setStations] = useState<Station[]>(() => withDistances(DEMO_STATIONS, DEFAULT_HOME));
  const [selectedId, setSelectedId] = useState(DEMO_STATIONS[0].id);
  const [status, setStatus] = useState<"loading" | "live" | "demo">("demo");
  const [statusMessage, setStatusMessage] = useState("Esimerkkihinnat – yhdistä Supabase live-dataa varten");
  const [locationOpen, setLocationOpen] = useState(false);
  const [reportStation, setReportStation] = useState<Station | null>(null);
  const [alertStation, setAlertStation] = useState<Station | null>(null);
  const [alertRules, setAlertRules] = useState<PriceAlertRule[]>([]);
  const [alertStatus, setAlertStatus] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

  useEffect(() => {
    const linkedFuel = new URLSearchParams(window.location.search).get("fuel") as FuelType;
    if (FUEL_TYPES.includes(linkedFuel)) window.setTimeout(() => setFuel(linkedFuel), 0);
    const saved = window.localStorage.getItem(HOME_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Coordinates;
      if (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng) && parsed.label) {
        const timer = window.setTimeout(() => setHome(parsed), 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      window.localStorage.removeItem(HOME_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!("serviceWorker" in navigator)) return;

    const now = Date.now();
    for (const rule of alertRules) {
      if (rule.delivery === "push") continue;
      const station = stations.find((candidate) => stationAlertKey(candidate) === rule.stationId);
      const snapshot = station?.prices[rule.fuel];
      if (!station || !snapshot) continue;
      const key = `tankkaussykli.notified.${rule.id}`;
      let previous: { observedAt?: string; notifiedAt?: number } = {};
      try {
        const stored = JSON.parse(window.localStorage.getItem(key) ?? "{}");
        previous = typeof stored === "number" ? { notifiedAt: stored } : stored ?? {};
      } catch { /* An old malformed cooldown record is ignored. */ }
      if (!shouldNotifyLocally(snapshot.observedAt, snapshot.price, rule.threshold, previous, now, !!station.isDemo)) continue;
      // Persist before the async call to avoid duplicate concurrent effects; undo on failure.
      const next = JSON.stringify({ observedAt: snapshot.observedAt, notifiedAt: now });
      window.localStorage.setItem(key, next);
      void navigator.serviceWorker.ready.then((registration) => registration.showNotification("Hintavahti: hintaraja täyttyi", {
        body: `${station.name} · ${rule.fuel} ${snapshot.price.toFixed(3)} €/l · ${formatFreshness(snapshot.observedAt)}`,
        icon: "/app-icon.svg", tag: rule.id,
      })).catch(() => { if (window.localStorage.getItem(key) === next) window.localStorage.removeItem(key); });
    }
  }, [alertRules, stations]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      let local: PriceAlertRule[] = [];
      try {
        const parsed = JSON.parse(window.localStorage.getItem(ALERT_STORAGE_KEY) ?? "[]") as PriceAlertRule[];
        local = parsed.filter((rule) => rule && rule.id && rule.stationId && FUEL_TYPES.includes(rule.fuel) && Number.isFinite(rule.threshold));
      } catch { window.localStorage.removeItem(ALERT_STORAGE_KEY); }
      setAlertRules(local);
      void loadBackgroundAlerts().then((rules) => {
        if (!active) return;
        if (rules === null) {
          if (local.some((rule) => rule.delivery === "push")) setAlertStatus("Taustavahtien palveluasetukset tai aiempi käyttäjäistunto puuttuvat. Palvelintilaa ei voitu tarkistaa.");
          return;
        }
        setAlertRules((current) => {
          const serverIds = new Set(rules.map((rule) => rule.id));
          const merged = [...current.filter((rule) => rule.delivery !== "push" && !serverIds.has(rule.id)), ...rules];
          window.localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(merged));
          return merged;
        });
      }).catch(() => { if (active) setAlertStatus("Taustavahtien tilaa ei saatu palvelimelta. Tallennetut vahdit säilyvät; yritä päivittää sivu."); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  const loadStations = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      const demoStations = withDistances(demoStationsFor(home), home);
      setStations(demoStations);
      setSelectedId((current) => current || DEMO_STATIONS[0].id);
      setStatus("demo");
      setStatusMessage(`Esimerkkihinnat alueelle ${home.label} – lisää Supabase-avaimet live-tilaa varten`);
      return;
    }

    setStatus("loading");
    setStatusMessage("Haetaan lähiasemia ja tuoreita hintoja…");
    try {
      const discovered = await discoverStations(home);
      const priced = await enrichWithSupabasePrices(discovered, home, fuel);
      const sorted = [...priced].sort((a, b) => {
        const priceDifference = priceFor(a, fuel) - priceFor(b, fuel);
        return Number.isFinite(priceDifference) && priceDifference !== 0
          ? priceDifference
          : a.distanceKm - b.distanceKm;
      });
      setStations(sorted);
      const linkedStation = new URLSearchParams(window.location.search).get("station");
      setSelectedId((current) =>
        linkedStation && sorted.some((station) => station.id === linkedStation) ? linkedStation :
        sorted.some((station) => station.id === current) ? current : (sorted[0]?.id ?? ""),
      );
      setStatus("live");
      setStatusMessage(
        sorted.some((station) => station.prices[fuel])
          ? "Yhteisön tuoreimmat hintahavainnot"
          : "Asemat löytyivät – ensimmäisiä hintahavaintoja odotetaan",
      );
    } catch {
      setStations(withDistances(demoStationsFor(home), home));
      setSelectedId(DEMO_STATIONS[0].id);
      setStatus("demo");
      setStatusMessage("Datapalvelu ei vastannut – näytetään esimerkkihinnat");
    }
  }, [fuel, home]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStations]);

  const sortedStations = useMemo(
    () =>
      [...stations].sort((a, b) => {
        const aPrice = priceFor(a, fuel);
        const bPrice = priceFor(b, fuel);
        if (aPrice !== bPrice) return aPrice - bPrice;
        return a.distanceKm - b.distanceKm;
      }),
    [fuel, stations],
  );
  const selected = stations.find((station) => station.id === selectedId) ?? sortedStations[0];
  const cheapest = sortedStations.find((station) => station.prices[fuel]);
  const localPrices = sortedStations
    .map((station) => station.prices[fuel]?.price)
    .filter((price): price is number => typeof price === "number");
  const average = localPrices.length
    ? localPrices.reduce((sum, price) => sum + price, 0) / localPrices.length
    : null;
  const savingPerTank = cheapest && average ? Math.max(0, (average - priceFor(cheapest, fuel)) * 50) : 0;
  const tankSignal = getTankSignal(
    cheapest?.history[fuel] ?? [],
    cheapest?.prices[fuel]?.price,
  );

  function saveHome(nextHome: Coordinates) {
    setHome(nextHome);
    setLocationError("");
    window.localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify(nextHome));
  }

  async function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setLocationError("Selain ei tue paikannusta. Hae paikka nimellä.");
      return;
    }

    setLocating(true);
    setLocationError("");
    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          saveHome({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            label: "Nykyinen sijainti",
          });
          setLocationOpen(false);
          setLocating(false);
          resolve();
        },
        () => {
          setLocationError("Sijaintia ei saatu. Tarkista selaimen paikannuslupa tai hae paikka nimellä.");
          setLocating(false);
          resolve();
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
      );
    });
  }

  function updateReportedPrice(price: number, observedAt: string) {
    if (!reportStation) return;
    setStations((current) =>
      current.map((station) =>
        station.id === reportStation.id
          ? {
              ...station,
              prices: { ...station.prices, [fuel]: { price, observedAt, sampleCount: 1 } },
              history: {
                ...station.history,
                [fuel]: station.isDemo
                  ? generatedHistory(price)
                  : upsertObservedPrice(station.history[fuel] ?? [], price, observedAt),
              },
            }
          : station,
      ),
    );
  }

  async function savePriceAlert(station: Station, threshold: number, background: boolean) {
    if (!background && "Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    const stationId = stationAlertKey(station);
    const id = `${stationId}:${fuel}`;
    const serverRuleId = background ? await saveBackgroundAlert(station, fuel, threshold) : undefined;
    const rule: PriceAlertRule = {
      id,
      stationId,
      stationName: station.name,
      fuel,
      threshold,
      delivery: background ? "push" : "local",
      serverRuleId,
      pushEnabled: background ? true : undefined,
    };
    const nextRules = [...alertRules.filter((candidate) => candidate.id !== id), rule];
    setAlertRules(nextRules);
    window.localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(nextRules));
  }

  async function deletePriceAlert(station: Station) {
    const id = `${stationAlertKey(station)}:${fuel}`;
    const rule = alertRules.find((candidate) => candidate.id === id);
    if (rule?.delivery === "push") {
      if (!rule.serverRuleId) throw new Error("Taustavahdin tunniste puuttuu. Päivitä sivu.");
      await deleteBackgroundAlert(rule.serverRuleId);
    }
    const nextRules = alertRules.filter((candidate) => candidate.id !== id);
    setAlertRules(nextRules);
    window.localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(nextRules));
    window.localStorage.removeItem(`tankkaussykli.notified.${id}`);
  }

  const selectedAlert = selected
    ? alertRules.find(
        (rule) => rule.id === `${stationAlertKey(selected)}:${fuel}`,
      )
    : undefined;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="TankkausSykli etusivu">
          <span className="brand-mark"><Fuel aria-hidden="true" /></span>
          <span>Tankkaus<span>Sykli</span></span>
        </a>
        <button className="location-button" type="button" onClick={() => setLocationOpen(true)}>
          <MapPin aria-hidden="true" />
          <span><small>Kotipaikka</small>{home.label}</span>
          <ChevronRight aria-hidden="true" />
        </button>
      </header>

      <section className="intro" id="top">
        <div>
          <p className="eyebrow"><Sparkles aria-hidden="true" /> Hintatutka alueelle {home.label}</p>
          <h1>Tankkaa fiksumpaan aikaan.</h1>
          <p>Vertaa lähiasemien hintoja, seuraa viikkorytmiä ja vältä kallis tankkauspäivä.</p>
        </div>
        <button className="secondary-button desktop-action" type="button" onClick={() => setLocationOpen(true)}>
          <LocateFixed aria-hidden="true" /> Vaihda aluetta
        </button>
      </section>

      <nav className="fuel-tabs" aria-label="Polttoainelaji">
        {FUEL_TYPES.map((fuelType) => (
          <button
            key={fuelType}
            type="button"
            aria-pressed={fuel === fuelType}
            onClick={() => setFuel(fuelType)}
          >
            {fuelType === "DIESEL" ? "Diesel" : fuelType}
          </button>
        ))}
      </nav>

      <section className={`signal-card signal-${tankSignal.state}`} aria-labelledby="signal-title">
        <div className="signal-icon"><Bell aria-hidden="true" /></div>
        <div className="signal-copy">
          <p className="eyebrow">Tämän hetken signaali</p>
          <h2 id="signal-title">{tankSignal.title}</h2>
          <p>
            {cheapest
              ? `${cheapest.name}: ${priceFor(cheapest, fuel).toFixed(3)} €/l. ${tankSignal.detail}`
              : "Ilmoita ensimmäinen pumpulla näkemäsi hinta."}
          </p>
        </div>
        {cheapest && (
          <div className="signal-saving">
            <span>Arvioitu säästö / 50 l</span>
            <strong>{savingPerTank.toFixed(2).replace(".", ",")} €</strong>
          </div>
        )}
      </section>

      <div className="data-status" role="status">
        <span className={`status-dot status-${status}`} />
        <span>{statusMessage}</span>
        <button type="button" onClick={() => void loadStations()} disabled={status === "loading"}>
          <RefreshCw className={status === "loading" ? "spin" : ""} aria-hidden="true" /> Päivitä
        </button>
      </div>

      {alertStatus && <p className="inline-alert" role="status">{alertStatus}</p>}
      {locationError && <p className="inline-alert">{locationError}</p>}

      <section className="map-section" aria-labelledby="map-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">25 km säteellä</p>
            <h2 id="map-title">Halpa bensa kartalla</h2>
          </div>
          <span>{stations.length} asemaa</span>
        </div>
        <div className="map-frame">
          <StationMap
            home={home}
            stations={stations}
            fuel={fuel}
            selectedId={selected?.id}
            onSelect={(station) => setSelectedId(station.id)}
          />
        </div>
      </section>

      <div className="content-grid">
        <section className="station-section" aria-labelledby="stations-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Edullisin ensin</p>
              <h2 id="stations-title">Lähiasemat</h2>
            </div>
          </div>
          <div className="station-list">
            {sortedStations.slice(0, 8).map((station, index) => {
              const snapshot = station.prices[fuel];
              return (
                <button
                  className={`station-row${selected?.id === station.id ? " station-row-selected" : ""}`}
                  key={station.id}
                  type="button"
                  onClick={() => setSelectedId(station.id)}
                >
                  <span className="station-rank">{index + 1}</span>
                  <span className="station-info">
                    <strong>{station.name}</strong>
                    <small><Navigation aria-hidden="true" /> {formatDistance(station.distanceKm)} · {formatFreshness(snapshot?.observedAt)}</small>
                  </span>
                  <span className="station-price">
                    <strong>{snapshot ? snapshot.price.toFixed(3) : "–"}</strong>
                    <small>€/l</small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>

        {selected && (
          <section className="station-detail" aria-labelledby="detail-title">
            <div className="detail-heading">
              <div>
                <p className="eyebrow">Valittu asema</p>
                <h2 id="detail-title">{selected.name}</h2>
                <p>{selected.address}</p>
              </div>
              <div className="detail-price">
                <strong>{selected.prices[fuel]?.price.toFixed(3) ?? "–"}</strong><span> €/l</span>
              </div>
            </div>
            <div className="detail-meta">
              <span><Route aria-hidden="true" /> {formatDistance(selected.distanceKm)} päässä</span>
              <span><Clock3 aria-hidden="true" /> {formatFreshness(selected.prices[fuel]?.observedAt)}</span>
            </div>
            <button
              className={`price-watch${selectedAlert ? " price-watch-active" : ""}`}
              type="button"
              onClick={() => setAlertStation(selected)}
            >
              <Bell aria-hidden="true" />
              <span>
                <strong>{selectedAlert ? "Hintavahti käytössä" : "Aseta hintavahti"}</strong>
                <small>
                  {selectedAlert
                    ? `${selectedAlert.delivery === "push" ? selectedAlert.pushEnabled === false ? "Push vanhentunut" : "Taustavahti" : "Vain sovelluksen ollessa auki"}: ${fuel} ≤ ${selectedAlert.threshold.toFixed(3)} €/l`
                    : "Saat ilmoituksen, kun oma hintarajasi alittuu"}
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
            <PriceChart points={selected.history[fuel] ?? []} />
            <div className="detail-actions">
              <a
                className="secondary-button"
                href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation aria-hidden="true" /> Reittiohje
              </a>
              <button className="primary-button" type="button" onClick={() => setReportStation(selected)}>
                <Fuel aria-hidden="true" /> Ilmoita hinta
              </button>
            </div>
          </section>
        )}
      </div>

      <footer>
        <span><Fuel aria-hidden="true" /> TankkausSykli</span>
        <p>Yhteisön hintahavainnot ovat suuntaa antavia. Tarkista lopullinen hinta pumpulta.</p>
      </footer>

      <LocationSheet
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        onSelect={saveHome}
        onUseCurrentLocation={useCurrentLocation}
        locating={locating}
      />
      {reportStation && (
        <ReportPriceSheet
          key={`${reportStation.id}-${fuel}`}
          station={reportStation}
          fuel={fuel}
          onClose={() => setReportStation(null)}
          onSaved={updateReportedPrice}
        />
      )}
      {alertStation && (
        <PriceAlertSheet
          key={`${stationAlertKey(alertStation)}-${fuel}`}
          station={alertStation}
          fuel={fuel}
          currentRule={alertRules.find(
            (rule) => rule.id === `${stationAlertKey(alertStation)}:${fuel}`,
          )}
          onClose={() => setAlertStation(null)}
          onSave={(threshold, background) => savePriceAlert(alertStation, threshold, background)}
          onDelete={() => deletePriceAlert(alertStation)}
        />
      )}
    </main>
  );
}
