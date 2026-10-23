"use client";
import { useMemo } from "react";
import { CalendarPlus, Clock3, MessageSquare, Phone, Trash2 } from "lucide-react";

import type { WaitlistEntry } from "../lib/booking-types";
import { waitlistTimePreferenceLabels } from "../lib/booking-labels";
import { dateFromKey, dayKey, getPhoneDigits } from "../lib/booking-selectors";
import ProfileAvatar from "./profile-avatar";
import SalonDialog from "./salon-dialog";

const WEEKDAY_SHORT = ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"];
const monthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });
const fullDateFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" });
const shortDateFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
const mondayIndex = (date: Date) => (date.getDay() + 6) % 7;

/** The days the client picked; older entries only have a range, which then counts as every day in it. */
const entryDays = (entry: WaitlistEntry) => {
  if (entry.dates && entry.dates.length > 0) return [...new Set(entry.dates)].sort();
  const days: string[] = [];
  const cursor = dateFromKey(entry.dateFrom);
  const end = dateFromKey(entry.dateTo);
  while (cursor <= end && days.length < 62) {
    days.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

type Props = {
  entry: WaitlistEntry;
  today: Date;
  canManageSchedule: boolean;
  removing: boolean;
  /** `dateKey` is the day the barber tapped; the booking opens on it and the hour is chosen there. */
  onBook: (entry: WaitlistEntry, dateKey?: string) => void;
  onRemove: (entry: WaitlistEntry) => void;
  onClose: () => void;
};

/**
 * One person on the waiting list: what they want, which days suit them (as a calendar where every day
 * they can come is a button that starts the booking on that day), and how to reach them.
 */
export default function WaitlistDetailDialog({ entry, today, canManageSchedule, removing, onBook, onRemove, onClose }: Props) {
  const todayKey = dayKey(today);
  const days = useMemo(() => entryDays(entry), [entry]);
  const chosen = useMemo(() => new Set(days), [days]);
  const months = useMemo(() => {
    const keys = [...new Set(days.map((key) => key.slice(0, 7)))];
    return keys.map((key) => {
      const [year, month] = key.split("-").map(Number);
      return new Date(year, month - 1, 1);
    });
  }, [days]);
  const digits = getPhoneDigits(entry.phone);
  const offered = entry.status === "offered" && entry.offer;

  return (
    <SalonDialog title={`Lista rezerwowa: ${entry.clientName}`} onClose={onClose} className="waitlist-dialog">
      {(close) => (
        <>
          <div className="waitlist-dialog-head">
            <ProfileAvatar className="waitlist-dialog-avatar" name={entry.clientName} />
            <div>
              <span className="salon-overline">LISTA REZERWOWA</span>
              <h2>{entry.clientName}</h2>
              <p>{entry.serviceName} · {entry.durationMinutes} min</p>
            </div>
          </div>

          {offered ? (
            <p className="waitlist-dialog-offer" role="status">
              Oferta wysłana: {shortDateFormatter.format(dateFromKey(entry.offer!.dateKey))}, {entry.offer!.startTime}
            </p>
          ) : null}

          <p className="waitlist-dialog-time">
            <Clock3 aria-hidden="true" />
            <span>{waitlistTimePreferenceLabels[entry.timePreference]}</span>
          </p>

          <p className="waitlist-dialog-label">
            Dni, w które może przyjść{canManageSchedule ? " — dotknij dnia, aby umówić" : ""}
          </p>
          <div className="waitlist-dialog-months">
            {months.map((month) => {
              const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
              const blanks = mondayIndex(month);
              return (
                <section className="waitlist-month" key={dayKey(month)} aria-label={monthFormatter.format(month)}>
                  <h3>{monthFormatter.format(month)}</h3>
                  <div className="waitlist-month-head" aria-hidden="true">
                    {WEEKDAY_SHORT.map((label) => <span key={label}>{label}</span>)}
                  </div>
                  <div className="waitlist-month-grid">
                    {Array.from({ length: blanks }, (_, index) => <span key={`b${index}`} aria-hidden="true" />)}
                    {Array.from({ length: total }, (_, index) => {
                      const date = new Date(month.getFullYear(), month.getMonth(), index + 1);
                      const key = dayKey(date);
                      if (!chosen.has(key)) return <span className="waitlist-day" key={key}>{index + 1}</span>;
                      const past = key < todayKey;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`waitlist-day is-chosen${key === todayKey ? " is-today" : ""}`}
                          disabled={!canManageSchedule || past}
                          aria-label={`${fullDateFormatter.format(date)} — umów`}
                          onClick={() => onBook(entry, key)}
                        >
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <p className="waitlist-legend"><i aria-hidden="true" />Dni, które pasują klientowi</p>

          <div className="waitlist-dialog-actions">
            {canManageSchedule ? (
              <button className="salon-cta" type="button" onClick={() => onBook(entry)}>
                <CalendarPlus aria-hidden="true" />
                Umów wizytę
              </button>
            ) : null}
            <div className="waitlist-dialog-contact">
              {digits.length === 9 ? (
                <>
                  <a href={`tel:+48${digits}`}><Phone aria-hidden="true" />Zadzwoń</a>
                  <a href={`sms:+48${digits}`}><MessageSquare aria-hidden="true" />SMS</a>
                </>
              ) : null}
              <button
                type="button"
                className="is-danger"
                disabled={removing}
                aria-busy={removing}
                onClick={() => { onRemove(entry); close(); }}
              >
                <Trash2 aria-hidden="true" />
                Usuń z listy
              </button>
            </div>
          </div>
        </>
      )}
    </SalonDialog>
  );
}
