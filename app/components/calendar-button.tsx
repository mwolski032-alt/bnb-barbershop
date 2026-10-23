"use client";
import { useEffect, useState } from "react";
import { CalendarPlus } from "lucide-react";

import type { BookingSummary } from "../lib/booking-types";
import {
  addToCalendar,
  getCalendarChoices,
  getSavedCalendarChoice,
  saveCalendarChoice,
  warmSalonAddress,
  type CalendarChoice,
} from "../lib/calendar-export";
import SalonDialog from "./salon-dialog";

/**
 * "Dodaj do kalendarza". The first tap opens a sheet at the bottom with the calendars available on this
 * phone (on a Samsung: Kalendarz Samsung first). "Zapamiętaj mój wybór" makes every next tap go straight
 * to that calendar, with a small "Zmień kalendarz" link to ask again.
 */
export default function CalendarButton({ summary }: { summary: BookingSummary | null }) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<CalendarChoice[]>([]);
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<CalendarChoice | null>(null);

  // The device is only known in the browser, so the lists are read after mounting.
  useEffect(() => {
    warmSalonAddress();
    const all = getCalendarChoices();
    setChoices(all);
    setSaved(all.find((choice) => choice.id === getSavedCalendarChoice()) ?? null);
  }, []);

  const run = (choice: CalendarChoice, keep: boolean) => {
    if (!summary) return;
    addToCalendar(summary, choice.id);
    if (keep) { saveCalendarChoice(choice.id); setSaved(choice); }
  };

  return (
    <>
      <button
        className="calendar-add-button"
        type="button"
        disabled={!summary}
        onClick={() => (saved ? run(saved, true) : setOpen(true))}
      >
        <CalendarPlus aria-hidden="true" />
        <span>Dodaj do kalendarza</span>
      </button>
      {saved ? (
        <button className="calendar-change-link" type="button" onClick={() => { saveCalendarChoice(null); setSaved(null); setOpen(true); }}>
          Zapisuję w: {saved.label}. Zmień kalendarz
        </button>
      ) : null}
      {open ? (
        <SalonDialog title="Dodaj do kalendarza" className="calendar-sheet" onClose={() => setOpen(false)}>
          {(close) => (
            <>
              <h2>Dodaj do kalendarza</h2>
              <p className="calendar-sheet-lead">Wybierz, gdzie zapisać wizytę. Wszystkie dane wpiszą się same.</p>
              <ul className="calendar-sheet-list">
                {choices.map((choice) => (
                  <li key={choice.id}>
                    <button type="button" onClick={() => { run(choice, remember); close(); }}>
                      <strong>{choice.label}</strong>
                      <small>{choice.hint}</small>
                    </button>
                  </li>
                ))}
              </ul>
              <label className="calendar-sheet-remember">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>Zapamiętaj mój wybór</span>
              </label>
            </>
          )}
        </SalonDialog>
      ) : null}
    </>
  );
}
