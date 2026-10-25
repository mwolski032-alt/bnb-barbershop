import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { AdminAppointment } from "../lib/booking-types";
import { formatPhoneNumber } from "../lib/booking-format";
import { getPhoneDigits, normalizeAppointmentStatus } from "../lib/booking-selectors";
import { subscribeClientProfile, type ClientProfile } from "../lib/client-profile";

type FormState = { fullName: string; phone: string };
type SignedInUser = { uid: string; displayName?: string | null; email?: string | null; photoURL?: string | null };

/**
 * The signed-in client's own choices from "Moje konto": name, phone, picture and favourite barber, plus the
 * numbers shown on the account card. A saved name and phone fill the booking form without overwriting typing.
 */
export function useClientAccount({ user, ownAppointments, upcoming, barbers, setForm }: {
  user: SignedInUser | null;
  ownAppointments: AdminAppointment[];
  /** The client's upcoming visits, soonest first. */
  upcoming: AdminAppointment[];
  barbers: { id: string; name: string }[];
  setForm: Dispatch<SetStateAction<FormState>>;
}) {
  const uid = user?.uid ?? "";
  const [profile, setProfile] = useState<ClientProfile>({});
  useEffect(() => {
    if (!uid) { setProfile({}); return undefined; }
    return subscribeClientProfile(uid, setProfile);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    setForm((current) => {
      const nameIsDefault = !current.fullName.trim() || current.fullName === user?.displayName;
      const fullName = profile.displayName && nameIsDefault ? profile.displayName : current.fullName;
      const phone = profile.phone && !getPhoneDigits(current.phone) ? formatPhoneNumber(profile.phone) : current.phone;
      return fullName === current.fullName && phone === current.phone ? current : { ...current, fullName, phone };
    });
    // Only the profile's own values should trigger this; the form is read through the updater.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, profile.displayName, profile.phone]);

  const name = profile.displayName || user?.displayName || user?.email || "Użytkownik";
  const stats = useMemo(() => {
    const settled = ownAppointments.filter((appointment) => appointment.userId === uid && normalizeAppointmentStatus(appointment.status) === "completed");
    const perBarber = new Map<string, number>();
    for (const appointment of settled) perBarber.set(appointment.barberId, (perBarber.get(appointment.barberId) ?? 0) + 1);
    const topBarberId = [...perBarber.entries()].sort((first, second) => second[1] - first[1])[0]?.[0];
    const next = upcoming[0];
    const [year, month, day] = (next?.dateKey ?? "").split("-").map(Number);
    return {
      visits: settled.length,
      topBarber: (barbers.find((barber) => barber.id === topBarberId)?.name ?? "").split(/\s+/)[0],
      next: next && year ? `${new Date(year, month - 1, day).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}, ${next.startTime}` : "",
    };
  }, [barbers, ownAppointments, uid, upcoming]);

  return { profile, name, photoUrl: profile.photoUrl || user?.photoURL, stats };
}
