"use client";
import { useCallback, useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { realtimeDb } from "../lib/firebase";
import { defaultWorkSettings, normalizeServices, normalizeWorkSettings } from "../lib/booking-selectors";
import type { Service, WorkSettings } from "../lib/booking-types";

export function useBarberCatalog(uid: string, barberId: string) {
  const [retryVersion, setRetryVersion] = useState(0);
  const retryCatalog = useCallback(() => setRetryVersion(value => value + 1), []);
  const [workSettingsError, setWorkSettingsError] = useState("");
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
    setWorkSettingsError("");
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
      setWorkSettingsError("");
    }, () => {
      if (stopped) return;
      setLoadedWorkBarberId("");
      setBarberWorkSettings(defaultWorkSettings);
      setWorkSettingsError("Nie udało się pobrać godzin pracy. Spróbuj ponownie.");
    });
    return () => { stopped = true; services(); work(); };
  }, [uid, barberId, retryVersion]);
  return { barberServices, setBarberServices, loadedServicesBarberId, areBarberServicesLoading, barberServicesError,
    barberWorkSettings, setBarberWorkSettings, loadedWorkBarberId, workSettingsError, retryCatalog };
}
