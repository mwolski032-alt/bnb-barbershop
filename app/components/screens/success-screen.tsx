"use client";
import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import type { PushDeviceStatus } from "../../lib/notifications";
import type { BookingSummary } from "../../lib/booking-types";
import { dayFormatter, formatDuration } from "../../lib/booking-format";
import CalendarButton from "../calendar-button";
import ProfileAvatar from "../profile-avatar";

type SuccessScreenProps = {
  summary: BookingSummary | null;
  /** False while the booking is still being confirmed: the ring spins, then turns into a check. */
  ready: boolean;
  /** The device's notification state: a client with notifications off is offered reminders for this visit. */
  push?: { status: PushDeviceStatus; busy: boolean; onEnable: () => void };
};

/** Shown only to someone whose notifications were off when they booked; it turns into a thank-you once they are on. */
function ReminderOffer({ push }: { push: NonNullable<SuccessScreenProps["push"]> }) {
  const [offered, setOffered] = useState(false);
  useEffect(() => { if (push.status === "disabled") setOffered(true); }, [push.status]);
  if (!offered) return null;
  const done = push.status === "enabled";
  return (
    <div className={`success-notify ${done ? "is-done" : ""}`} role="status">
      <span className="success-notify-icon" aria-hidden="true"><i />{done ? <Check /> : <Bell />}</span>
      <span className="success-notify-copy">
        <strong>{done ? "Gotowe, przypomnimy Ci o wizycie" : "Chcesz dostać przypomnienie o tej wizycie?"}</strong>
        <small>{done ? "Dostaniesz też wiadomość, gdy barber zmieni termin." : "Damy Ci znać przed wizytą i od razu, gdy barber zmieni termin."}</small>
      </span>
      {!done && <button type="button" onClick={push.onEnable} disabled={push.busy} aria-busy={push.busy}>{push.busy ? "Włączam…" : "Włącz"}</button>}
    </div>
  );
}

export default function SuccessScreen({ summary, ready, push }: SuccessScreenProps) {
  return (
    <section className="success-view" aria-label="Potwierdzenie wizyty">
      <div className="success-topbar">
        <img className="success-logo-mark" src="/brand/bnb-logo.png" alt="BNB Barbershop" />
      </div>

      <div className={`success-loader ${ready ? "done" : ""}`} aria-live="polite">
        <span className="loader-ring" />
        <span className="loader-check" aria-hidden="true" />
      </div>

      {ready && summary ? (
        <div className="success-summary">
          <p className="eyebrow">Wizyta potwierdzona</p>
          <h1>{summary.serviceName}</h1>
          <div className="success-barber">
            <ProfileAvatar
              className="success-barber-avatar"
              name={summary.barberName}
              photoUrl={summary.barberPhotoUrl}
            />
            <span>
              <small>Twój barber</small>
              <strong>{summary.barberName}</strong>
            </span>
          </div>
          <div className="success-details">
            <span>{dayFormatter.format(summary.date)}</span>
            <span>{summary.time}</span>
            <span>{formatDuration(summary.durationMinutes)}</span>
            <span>{summary.servicePrice}</span>
          </div>
          <div className="client-summary">
            <span>{summary.fullName}</span>
            <span>{summary.phone}</span>
          </div>
          <CalendarButton summary={summary} />
          {push && <ReminderOffer push={push} />}
        </div>
      ) : null}
    </section>
  );
}
