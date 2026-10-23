import {
  enqueueOfflineAction,
  removeQueuedAction,
  sanitizeQueue,
} from "../../shared/offline-queue.mjs";

export type OfflineQueueItem = {
  action: "attend_client" | "cancel_client";
  operationId: string;
  appointmentId: string;
  expectedVersion: number;
  queuedAt: number;
};

type Snapshot<T> = { savedAt: number; appointments: T[] };

const queueKey = (uid: string) => `bnb-offline-queue-${uid}`;
const snapshotKey = (uid: string) => `bnb-offline-appointments-${uid}`;

const readJson = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: offline mode just has less to show.
  }
};

export const readOfflineQueue = (uid: string): OfflineQueueItem[] =>
  sanitizeQueue(readJson(queueKey(uid))) as OfflineQueueItem[];

export const addToOfflineQueue = (uid: string, item: OfflineQueueItem) => {
  const next = enqueueOfflineAction(readOfflineQueue(uid), item) as OfflineQueueItem[];
  writeJson(queueKey(uid), next);
  return next;
};

export const removeFromOfflineQueue = (uid: string, operationId: string) => {
  const next = removeQueuedAction(readOfflineQueue(uid), operationId) as OfflineQueueItem[];
  writeJson(queueKey(uid), next);
  return next;
};

/** The client's own visits as last seen online, so they can still be shown without a connection. */
export const saveOfflineAppointments = <T,>(uid: string, appointments: T[]) => {
  if (!uid) return;
  writeJson(snapshotKey(uid), { savedAt: Date.now(), appointments } satisfies Snapshot<T>);
};

export const readOfflineAppointments = <T,>(uid: string): Snapshot<T> | null => {
  const value = readJson(snapshotKey(uid)) as Snapshot<T> | null;
  return value && Array.isArray(value.appointments) && Number.isFinite(value.savedAt) ? value : null;
};

/** On sign-out the saved visits (they hold contact details) go; the queue holds only ids and stays. */
export const clearOfflineAppointments = (uid: string) => {
  try {
    window.localStorage.removeItem(snapshotKey(uid));
  } catch {
    // Nothing to clean when storage is blocked.
  }
};
