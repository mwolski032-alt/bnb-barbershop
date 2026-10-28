import { getAuth } from "firebase/auth";

import { firebaseApp } from "./firebase";

export type BroadcastReach = { recipients: number; reachable: number };
export type BroadcastResult = BroadcastReach & { sent: number; failed: number };

async function call<T>(payload: { action: "preview" | "send"; text?: string }): Promise<T> {
  const user = getAuth(firebaseApp).currentUser;
  if (!user) throw new Error("Sesja wygasła. Zaloguj się ponownie.");
  const response = await fetch("/api/broadcast", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error || "Nie udało się wysłać wiadomości.");
  return result;
}

/** How many clients a message would reach. Throws an Error whose message can be shown as it is. */
export const previewBroadcast = () => call<BroadcastReach>({ action: "preview" });

export const sendBroadcast = (text: string) => call<BroadcastResult>({ action: "send", text });
