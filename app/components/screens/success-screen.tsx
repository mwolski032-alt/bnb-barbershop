"use client";
import type { BookingSummary } from "../../lib/booking-types";
import { dayFormatter, formatDuration } from "../../lib/booking-format";
import CalendarButton from "../calendar-button";
import ProfileAvatar from "../profile-avatar";

type SuccessScreenProps = {
  summary: BookingSummary | null;
  /** False while the booking is still being confirmed: the ring spins, then turns into a check. */
  ready: boolean;
};

export default function SuccessScreen({ summary, ready }: SuccessScreenProps) {
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
        </div>
      ) : null}
    </section>
  );
}
