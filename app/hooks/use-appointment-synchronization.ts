"use client";

import { useCallback, useEffect, useRef } from "react";
import { onValue, ref } from "firebase/database";
import { createSnapshotGate, createScopedRefreshQueue } from "../../shared/scoped-sync.mjs";
import { realtimeDb } from "../lib/firebase";
import { fetchClientAppointmentData, type AppointmentApiResult } from "../lib/appointments";

type Context = { uid: string; barberId: string; generation: number };

export function useAppointmentSynchronization<T>(uid: string, barberId: string,
  receive: (result: AppointmentApiResult<T>) => boolean, onError: () => void) {
  const gate = useRef(createSnapshotGate());
  const queue = useRef(createScopedRefreshQueue());
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => { gate.current.activate(uid, barberId); }, [uid, barberId]);

  const captureSnapshotContext = useCallback(() => gate.current.capture(), []);
  const applyAppointmentSnapshot = useCallback((result: AppointmentApiResult<T>, token: Context) => {
    if (!gate.current.accept(result.sync, token)) return false;
    return receive(result);
  }, [receive]);

  const refreshClientAppointmentData = useCallback((invalidate: boolean | (() => boolean) = false): Promise<AppointmentApiResult<T>> => {
    const token = captureSnapshotContext();
    const key = JSON.stringify(token);
    return queue.current.run(key, async () => {
      if (!gate.current.isCurrent(token) || !token.uid) return { ok: false };
      try {
        const result = await fetchClientAppointmentData<T>(token.barberId);
        applyAppointmentSnapshot(result, token);
        return result;
      } catch (error) {
        if (gate.current.isCurrent(token)) onError();
        throw error;
      }
    }, invalidate) as Promise<AppointmentApiResult<T>>;
  }, [captureSnapshotContext, applyAppointmentSnapshot, onError]);

  useEffect(() => {
    if (!uid) return;
    const refresh = (invalidate: boolean | (() => boolean) = false) => { void refreshClientAppointmentData(invalidate).catch(() => undefined); };
    refresh();
    const visible = () => { if (document.visibilityState === "visible") refresh(true); };
    document.addEventListener("visibilitychange", visible);
    const sources = [
      { source: "user", path: `appointmentSync/users/${uid}/revision` },
      ...(barberId ? [{ source: "barber", path: `appointmentSync/barbers/${barberId}/revision` }] : []),
    ];
    const unsubscribers = sources.map(({ source, path }) => onValue(ref(realtimeDb, path), snapshot => {
      const token = gate.current.capture();
      const revision = snapshot.val();
      const stillNeeded = () => gate.current.isCurrent(token) && gate.current.needsRefresh(source, revision);
      if (stillNeeded()) refresh(stillNeeded);
    }, () => undefined));
    if (typeof BroadcastChannel !== "undefined") {
      const nextChannel = new BroadcastChannel("bnb-appointment-sync");
      channel.current = nextChannel;
      nextChannel.onmessage = event => { if (event.data?.uid === uid) refresh(true); };
    }
    return () => {
      document.removeEventListener("visibilitychange", visible);
      unsubscribers.forEach(unsubscribe => unsubscribe());
      channel.current?.close();
      channel.current = null;
    };
  }, [uid, barberId, refreshClientAppointmentData]);

  const broadcastChange = useCallback(() => channel.current?.postMessage({ uid }), [uid]);
  return { captureSnapshotContext, applyAppointmentSnapshot, refreshClientAppointmentData, broadcastChange };
}
