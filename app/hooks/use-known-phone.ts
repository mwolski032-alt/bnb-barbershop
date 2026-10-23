import { useEffect, useRef } from "react";

import type { AdminAppointment } from "../lib/booking-types";
import { getAppointmentSortValue, getPhoneDigits } from "../lib/booking-selectors";
import { formatPhoneNumber } from "../lib/booking-format";

/**
 * A returning client never retypes the phone number: the newest valid number from their earlier visits is
 * handed to `fill` once per sign-in. `fill` must only change forms whose phone is still empty.
 */
export function useKnownPhone(uid: string | undefined, appointments: AdminAppointment[], fill: (phone: string) => void) {
  const doneFor = useRef("");
  useEffect(() => {
    if (!uid) { doneFor.current = ""; return; }
    if (doneFor.current === uid) return;
    const known = appointments
      .filter((appointment) => appointment.userId === uid && getPhoneDigits(appointment.phone ?? "").length === 9)
      .sort((first, second) => getAppointmentSortValue(second).localeCompare(getAppointmentSortValue(first)))[0];
    if (!known) return;
    doneFor.current = uid;
    fill(formatPhoneNumber(getPhoneDigits(known.phone ?? "")));
    // `fill` is a fresh closure on every render; the ref above makes the effect run its work once per sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, appointments]);
}
