"use client";
import { useEffect } from "react";
import { Check } from "lucide-react";

import { pluralPl } from "../../shared/daily-summary.mjs";
import type { AdminAppointment } from "../lib/booking-types";
import { dateFromKey, getAppointmentPriceValue } from "../lib/booking-selectors";
import SalonDialog from "./salon-dialog";

const dayFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
const formatMoney = (value: number) => `${value.toFixed(2).replace(/\.00$/, "").replace(".", ",")} zł`;

type Props = {
  visits: AdminAppointment[];
  settlingId: string | null;
  busy: boolean;
  onSettle: (appointment: AdminAppointment) => void;
  onNoShow: (appointment: AdminAppointment) => void;
  onSettleAll: () => void;
  onClose: () => void;
};

/**
 * End-of-day window for the barber: every finished visit that is still open, with one big button each.
 * It appears only when something is left, so the analytics always add up.
 */
export default function UnsettledDialog({ visits, settlingId, busy, onSettle, onNoShow, onSettleAll, onClose }: Props) {
  const done = visits.length === 0;
  // Everything closed: show the confirmation for a moment, then leave on its own.
  useEffect(() => {
    if (!done) return undefined;
    const timer = window.setTimeout(onClose, 2200);
    return () => window.clearTimeout(timer);
  }, [done, onClose]);

  const total = visits.reduce((sum, visit) => sum + (getAppointmentPriceValue(visit) || 0), 0);

  return (
    <SalonDialog title="Nierozliczeni" onClose={onClose} className="salon-unsettled-dialog">
      {(close) => done ? (
        <div className="unsettled-done" role="status">
          <span className="unsettled-done-mark" aria-hidden="true"><Check /></span>
          <h2>Wszystko rozliczone</h2>
          <p>Dzień zamknięty, w analizie wszystko się zgadza.</p>
        </div>
      ) : (
        <>
          <span className="salon-overline">KONIEC DNIA</span>
          <h2>Nierozliczeni</h2>
          <p className="unsettled-lead">
            {visits.length === 1 ? "Jedna wizyta czeka" : `${visits.length} ${pluralPl(visits.length, "wizyta czeka", "wizyty czekają", "wizyt czeka")}`} na rozliczenie. Rozlicz je teraz, żeby w analizie wszystko się zgadzało.
          </p>
          <button className="salon-cta unsettled-all" type="button" disabled={busy || Boolean(settlingId)} onClick={onSettleAll}>
            {visits.length === 1 ? "Rozlicz" : `Rozlicz wszystkie (${visits.length})`} · {formatMoney(total)}
          </button>
          <ul className="unsettled-list">
            {visits.map((visit) => (
              <li key={visit.id}>
                <div className="unsettled-visit">
                  <strong>{visit.clientName}</strong>
                  <small>
                    {dayFormatter.format(dateFromKey(visit.dateKey))}, {visit.startTime} · {visit.serviceName}
                  </small>
                </div>
                <b>{visit.price}</b>
                <div className="unsettled-actions">
                  <button className="unsettled-settle" type="button" disabled={busy || Boolean(settlingId)} aria-busy={settlingId === visit.id} onClick={() => onSettle(visit)}>
                    {settlingId === visit.id ? "Zapis…" : "Rozlicz"}
                  </button>
                  <button className="unsettled-noshow" type="button" disabled={busy || Boolean(settlingId)} onClick={() => onNoShow(visit)}>
                    Nie przyszedł
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button className="salon-ghost unsettled-later" type="button" onClick={close}>Później</button>
        </>
      )}
    </SalonDialog>
  );
}
