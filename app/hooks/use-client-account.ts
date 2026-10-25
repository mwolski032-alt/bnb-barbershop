import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { AdminAppointment } from "../lib/booking-types";
import { formatPhoneNumber } from "../lib/booking-format";
import { getAppointmentSortValue, getPhoneDigits, normalizeAppointmentStatus } from "../lib/booking-selectors";
import { ensurePhotoVersion, saveClientProfile, subscribeClientProfile, type ClientProfile } from "../lib/client-profile";

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
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    if (!uid) { setProfile({}); return undefined; }
    return subscribeClientProfile(uid, (value) => { setProfile(value); setLoaded(true); });
  }, [uid]);

  useEffect(() => {
    if (!uid || !loaded || !profile.photoUrl) return;
    const key = `bnb-photo-version:${uid}:${profile.updatedAt ?? 0}`;
    try { if (sessionStorage.getItem(key) === "1") return; sessionStorage.setItem(key, "1"); } catch { return; }
    ensurePhotoVersion(uid, profile.updatedAt || Date.now()).catch(() => undefined);
  }, [uid, loaded, profile.photoUrl, profile.updatedAt]);

  // The phone number typed for a first booking becomes the account's phone, once. Clearing it later sticks.
  const knownPhone = useMemo(() => {
    const latest = ownAppointments
      .filter((appointment) => appointment.userId === uid && getPhoneDigits(appointment.phone ?? "").length === 9)
      .sort((first, second) => getAppointmentSortValue(second).localeCompare(getAppointmentSortValue(first)))[0];
    return latest ? getPhoneDigits(latest.phone ?? "") : "";
  }, [ownAppointments, uid]);
  useEffect(() => {
    if (!uid || !loaded || profile.phone || !knownPhone) return;
    const key = `bnb-phone-synced:${uid}`;
    try { if (localStorage.getItem(key) === "1") return; localStorage.setItem(key, "1"); } catch { return; }
    saveClientProfile(uid, { ...profile, phone: knownPhone }).catch(() => { try { localStorage.removeItem(key); } catch { /* Retried next time. */ } });
  }, [uid, loaded, profile, knownPhone]);

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
