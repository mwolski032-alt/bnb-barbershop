"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyReplayResult, describeDropped } from "../../shared/offline-queue.mjs";
import { AppointmentApiError, mutateAppointment } from "../lib/appointments";
import {
  addToOfflineQueue,
  readOfflineQueue,
  removeFromOfflineQueue,
  type OfflineQueueItem,
} from "../lib/offline-store";

const RETRY_AFTER_MS = 15_000;

/** Starts as online so the server and the first client render agree; the browser's real state follows. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

type Options = {
  uid: string;
  online: boolean;
  /** Called after a replay that sent or dropped something, so the visits can be reloaded. */
  onSettled: () => void;
};

/**
 * Answers given offline ("I'll be there", "cancel") wait in this device's storage. When the connection is
 * back they are sent in order, each with the operation id it was given, so a resend never doubles it.
 */
export function useOfflineQueue({ uid, online, onSettled }: Options) {
  const [pendingCount, setPendingCount] = useState(0);
  const [notice, setNotice] = useState("");
  const [retryTick, setRetryTick] = useState(0);
  const replaying = useRef(false);
  const onSettledRef = useRef(onSettled);
  useEffect(() => { onSettledRef.current = onSettled; }, [onSettled]);

  useEffect(() => {
    setPendingCount(uid ? readOfflineQueue(uid).length : 0);
    setNotice("");
  }, [uid]);

  const enqueue = useCallback((item: OfflineQueueItem) => {
    if (!uid) return;
    setPendingCount(addToOfflineQueue(uid, item).length);
    // The browser may call a dead connection "online": look again shortly, so the answer is not stuck.
    setTimeout(() => setRetryTick((tick) => tick + 1), RETRY_AFTER_MS);
  }, [uid]);

  useEffect(() => {
    if (!uid || !online || replaying.current) return undefined;
    const queue = readOfflineQueue(uid);
    if (queue.length === 0) return undefined;

    replaying.current = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let sent = 0;
      const dropped: OfflineQueueItem[] = [];
      let mustRetry = false;
      for (const item of queue) {
        try {
          await mutateAppointment(item.action, { appointmentId: item.appointmentId }, {
            operationId: item.operationId,
            expectedVersion: item.expectedVersion,
          });
          removeFromOfflineQueue(uid, item.operationId);
          sent += 1;
        } catch (error) {
          const status = error instanceof AppointmentApiError ? error.status : 0;
          if (classifyReplayResult({ ok: false, status }) === "retry") {
            mustRetry = true;
            break;
          }
          removeFromOfflineQueue(uid, item.operationId);
          dropped.push(item);
        }
      }
      replaying.current = false;
      setPendingCount(readOfflineQueue(uid).length);
      if (dropped.length > 0) setNotice(describeDropped(dropped));
      if (sent > 0 || dropped.length > 0) onSettledRef.current();
      if (mustRetry) retryTimer = setTimeout(() => setRetryTick((tick) => tick + 1), RETRY_AFTER_MS);
    })();

    return () => { if (retryTimer) clearTimeout(retryTimer); };
  }, [uid, online, retryTick]);

  return { pendingCount, notice, dismissNotice: () => setNotice(""), enqueue };
}
