"use client";
import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { realtimeDb } from "../lib/firebase";
import { defaultWorkSettings, normalizeServices, normalizeWorkSettings } from "../lib/booking-selectors";
import type { Service, WorkSettings } from "../lib/booking-types";

export function useBarberCatalog(uid: string, barberId: string) {
  const [barberServices, setBarberServices] = useState<Service[]>([]);
  const [loadedServicesBarberId, setLoadedServicesBarberId] = useState("");
  const [areBarberServicesLoading, setAreBarberServicesLoading] = useState(false);
  const [barberServicesError, setBarberServicesError] = useState("");
  const [barberWorkSettings, setBarberWorkSettings] = useState<WorkSettings>(defaultWorkSettings);
  const [loadedWorkBarberId, setLoadedWorkBarberId] = useState("");
  useEffect(() => {
    setBarberServices([]);
    setLoadedServicesBarberId("");
    setBarberServicesError("");
    setLoadedWorkBarberId("");
    setBarberWorkSettings(defaultWorkSettings);
    setAreBarberServicesLoading(Boolean(uid && barberId));
    if (!uid || !barberId) return;
    let stopped = false;
    const services = onValue(ref(realtimeDb, `barbers/${barberId}/services`), snapshot => {
      if (stopped) return;
      setBarberServices(normalizeServices(snapshot.val(), barberId));
      setLoadedServicesBarberId(barberId);
      setAreBarberServicesLoading(false);
      setBarberServicesError("");
    }, () => {
      if (stopped) return;
      setBarberServices([]);
      setAreBarberServicesLoading(false);
      setBarberServicesError("Nie udało się pobrać usług. Spróbuj ponownie.");
    });
    const work = onValue(ref(realtimeDb, `barbers/${barberId}/workSettings`), snapshot => {
      if (stopped) return;
      setBarberWorkSettings(normalizeWorkSettings(snapshot.val(), barberId));
      setLoadedWorkBarberId(barberId);
    }, () => {
      if (stopped) return;
      setLoadedWorkBarberId("");
      setBarberWorkSettings(defaultWorkSettings);
    });
    return () => { stopped = true; services(); work(); };
  }, [uid, barberId]);
  return { barberServices, setBarberServices, loadedServicesBarberId, areBarberServicesLoading, barberServicesError,
    barberWorkSettings, setBarberWorkSettings, loadedWorkBarberId };
}
