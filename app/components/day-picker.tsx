"use client";
import { useMemo, useState } from "react";

import { dateFromKey, dayKey } from "../lib/booking-selectors";

const WEEKDAY_SHORT = ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"];
const WEEKDAY_PLURAL = ["poniedziałki", "wtorki", "środy", "czwartki", "piątki", "soboty", "niedziele"];
const monthLabelFormatter = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });
const fullDateFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" });
const mondayIndex = (date: Date) => (date.getDay() + 6) % 7;
const dayCountLabel = (count: number) => `${count} ${count === 1 ? "dzień" : "dni"}`;

type Props = {
  selected: string[];
  onChange: (dates: string[]) => void;
  today: Date;
  /** The last day that can be picked ("YYYY-MM-DD"). */
  lastKey: string;
};

/**
 * "Wybierz dni": the same chips, weekday buttons and calendar the barber uses to set the days he works,
 * so picking days works the same way on both sides. Tap to mark a day, tap again to unmark it.
 */
export default function DayPicker({ selected, onChange, today, lastKey }: Props) {
  const todayKey = dayKey(today);
  const [viewMonth, setViewMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [calendarOpen, setCalendarOpen] = useState(true);
  const chosen = useMemo(() => new Set(selected), [selected]);

  const monthDays = useMemo(() => {
    const total = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    return Array.from({ length: total }, (_, index) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), index + 1));
  }, [viewMonth]);
  const pickable = (key: string) => key >= todayKey && key <= lastKey;
  const upcomingMonthDays = monthDays.filter((date) => pickable(dayKey(date)));
  const isCurrentMonth = viewMonth.getFullYear() === today.getFullYear() && viewMonth.getMonth() === today.getMonth();
  const nextMonthStart = dayKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = dayKey(tomorrow);

  const change = (dates: string[]) => onChange(Array.from(new Set(dates)).sort());
  const allChosen = (keys: string[]) => keys.length > 0 && keys.every((key) => chosen.has(key));
  const toggle = (keys: string[]) => {
    if (keys.length === 0) return;
    change(allChosen(keys) ? selected.filter((key) => !keys.includes(key)) : [...selected, ...keys]);
  };

  const monthKeys = upcomingMonthDays.map(dayKey);
  const workdayKeys = upcomingMonthDays.filter((date) => mondayIndex(date) < 5).map(dayKey);
  const weekdayKeys = (index: number) => upcomingMonthDays.filter((date) => mondayIndex(date) === index).map(dayKey);
  const chosenInMonth = selected.filter((key) => key.startsWith(`${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, "0")}`)).length;
  const leadingBlanks = mondayIndex(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1));

  return (
    <>
      <p className="wk-help">Dotknij przycisku, żeby zaznaczyć. Dotknij jeszcze raz, żeby odznaczyć.</p>

      <div className="wk-month-nav">
        <button type="button" aria-label="Poprzedni miesiąc" disabled={isCurrentMonth} onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>‹</button>
        <strong>{monthLabelFormatter.format(viewMonth)}</strong>
        <button type="button" aria-label="Następny miesiąc" disabled={nextMonthStart > lastKey} onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>›</button>
      </div>

      <div className="wk-chips" role="group" aria-label="Szybki wybór dni w tym miesiącu">
        <button type="button" className={allChosen(monthKeys) ? "active" : ""} aria-pressed={allChosen(monthKeys)} disabled={monthKeys.length === 0} onClick={() => toggle(monthKeys)}>Cały miesiąc</button>
        <button type="button" className={allChosen(workdayKeys) ? "active" : ""} aria-pressed={allChosen(workdayKeys)} disabled={workdayKeys.length === 0} onClick={() => toggle(workdayKeys)}>Poniedziałek–piątek</button>
      </div>

      <p className="wk-label">Tylko wybrane dni tygodnia</p>
      <div className="wk-weekdays" role="group" aria-label="Dni tygodnia w tym miesiącu">
        {WEEKDAY_SHORT.map((label, index) => {
          const keys = weekdayKeys(index);
          const active = allChosen(keys);
          return (
            <button key={label} type="button" className={active ? "active" : ""} aria-pressed={active} aria-label={`Wszystkie ${WEEKDAY_PLURAL[index]} w tym miesiącu`} disabled={keys.length === 0} onClick={() => toggle(keys)}>{label}</button>
          );
        })}
      </div>

      <p className="wk-label">Pojedyncze dni</p>
      <div className="wk-chips" role="group" aria-label="Pojedyncze dni">
        <button type="button" className={chosen.has(todayKey) ? "active" : ""} aria-pressed={chosen.has(todayKey)} disabled={!pickable(todayKey)} onClick={() => toggle([todayKey])}>Dziś</button>
        <button type="button" className={chosen.has(tomorrowKey) ? "active" : ""} aria-pressed={chosen.has(tomorrowKey)} disabled={!pickable(tomorrowKey)} onClick={() => toggle([tomorrowKey])}>Jutro</button>
        <button type="button" className="wk-clear" disabled={selected.length === 0} onClick={() => change([])}>Wyczyść wybór</button>
      </div>

      <button className="wk-calendar-toggle" type="button" aria-expanded={calendarOpen} aria-controls="wk-day-picker-calendar" onClick={() => setCalendarOpen((open) => !open)}>
        <span>
          <strong>{calendarOpen ? "Ukryj kalendarz" : "Pokaż kalendarz"}</strong>
          <small>{chosenInMonth > 0 ? `W tym miesiącu wybrano ${dayCountLabel(chosenInMonth)}` : "W tym miesiącu nie wybrano jeszcze dni"}</small>
        </span>
        <b aria-hidden="true">⌄</b>
      </button>

      {calendarOpen ? (
        <div className="wk-calendar" id="wk-day-picker-calendar">
          <div className="wk-calendar-head" aria-hidden="true">{WEEKDAY_SHORT.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="wk-calendar-grid">
            {Array.from({ length: leadingBlanks }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
            {monthDays.map((date) => {
              const key = dayKey(date);
              const isSelected = chosen.has(key);
              return (
                <button key={key} type="button" className={`wk-day${isSelected ? " selected" : ""}`} disabled={!pickable(key)} aria-pressed={isSelected} aria-label={fullDateFormatter.format(dateFromKey(key))} onClick={() => toggle([key])}>
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="wk-legend"><span><i className="selected" aria-hidden="true" />Wybrane dni</span></div>
        </div>
      ) : null}
    </>
  );
}
