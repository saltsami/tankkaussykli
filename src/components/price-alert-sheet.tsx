"use client";

import { useState } from "react";
import { Bell, BellOff, Check, X } from "lucide-react";
import type { FuelType, PriceAlertRule, Station } from "@/lib/types";

type PriceAlertSheetProps = {
  station: Station;
  fuel: FuelType;
  currentRule?: PriceAlertRule;
  onClose: () => void;
  onSave: (threshold: number) => Promise<void>;
  onDelete: () => void;
};

export function PriceAlertSheet({
  station,
  fuel,
  currentRule,
  onClose,
  onSave,
  onDelete,
}: PriceAlertSheetProps) {
  const [value, setValue] = useState(() =>
    (currentRule?.threshold ?? station.prices[fuel]?.price ?? 1.75).toFixed(3),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const threshold = Number(value.replace(",", "."));
    if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 4) {
      setError("Anna hintaraja väliltä 0,500–4,000 €/l.");
      return;
    }

    setSaving(true);
    setError("");
    await onSave(threshold);
    setSaving(false);
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="sheet-panel report-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-sheet-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">{fuel}</p>
            <h2 id="alert-sheet-title">Aseta hintavahti</h2>
            <p>{station.name}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Sulje">
            <X aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={save}>
          <label className="price-input-label" htmlFor="alert-threshold">Ilmoita, kun hinta on enintään</label>
          <div className="price-input-wrap">
            <input
              id="alert-threshold"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="1,750"
              autoFocus
            />
            <span>€/l</span>
          </div>
          {error && <p className="form-message error-message">{error}</p>}
          <p className="sheet-note">
            Raja tallennetaan tälle laitteelle. MVP tarkistaa sen, kun sovellus on auki tai avataan.
            Selain voi pyytää ilmoitusluvan tallennuksen yhteydessä.
          </p>
          <button className="primary-button full-width" type="submit" disabled={saving}>
            {currentRule ? <Check aria-hidden="true" /> : <Bell aria-hidden="true" />}
            {saving ? "Tallennetaan…" : currentRule ? "Päivitä hintavahti" : "Ota hintavahti käyttöön"}
          </button>
          {currentRule && (
            <button
              className="danger-button full-width"
              type="button"
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              <BellOff aria-hidden="true" /> Poista hintavahti
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
