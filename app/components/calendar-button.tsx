"use client";
import { useEffect } from "react";
import { CalendarPlus } from "lucide-react";

import type { BookingSummary } from "../lib/booking-types";
import { addToCalendar, warmSalonAddress } from "../lib/calendar-export";

/**
 * "Dodaj do kalendarza": one button. The phone itself asks which calendar app should take the visit
 * (see addToCalendar), so there is no list of calendars to choose from here.
 */
export default function CalendarButton({ summary }: { summary: BookingSummary | null }) {
  useEffect(() => { warmSalonAddress(); }, []);

  return (
    <button
      className="calendar-add-button"
      type="button"
      disabled={!summary}
      onClick={() => { if (summary) addToCalendar(summary); }}
    >
      <CalendarPlus aria-hidden="true" />
      <span>Dodaj do kalendarza</span>
    </button>
  );
}
