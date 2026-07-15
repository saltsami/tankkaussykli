"use client";

import { useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { submitPriceObservation } from "@/lib/station-service";
import type { FuelType, Station } from "@/lib/types";

type ReportPriceSheetProps = {
  station: Station;
  fuel: FuelType;
  onClose: () => void;
  onSaved: (price: number, observedAt: string) => void;
};

export function ReportPriceSheet({ station, fuel, onClose, onSaved }: ReportPriceSheetProps) {
  const [value, setValue] = useState(() => station.prices[fuel]?.price.toFixed(3) ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = Number(value.replace(",", "."));
    if (!Number.isFinite(price) || price < 0.5 || price > 4) {
      setError("Anna hinta väliltä 0,500–4,000 €/l.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await submitPriceObservation(station, fuel, price);
      onSaved(price, result.observedAt);
      setSaved(true);
      window.setTimeout(onClose, 900);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hinnan tallennus epäonnistui.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="sheet-panel report-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-sheet-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">{fuel}</p>
            <h2 id="report-sheet-title">Ilmoita pumpun hinta</h2>
            <p>{station.name}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Sulje">
            <X aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={save}>
          <label className="price-input-label" htmlFor="price-report">Hinta euroina litralta</label>
          <div className="price-input-wrap">
            <input
              id="price-report"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="1,789"
              autoFocus
            />
            <span>€/l</span>
          </div>
          {error && <p className="form-message error-message">{error}</p>}
          <p className="sheet-note">Ilmoita vain paikan päällä näkemäsi tuore hinta.</p>
          <button className="primary-button full-width" type="submit" disabled={saving || saved}>
            {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
            {saved ? "Tallennettu" : saving ? "Tallennetaan…" : "Tallenna hinta"}
          </button>
        </form>
      </section>
    </div>
  );
}
