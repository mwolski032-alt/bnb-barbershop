import { getAuth } from "firebase/auth";

import { firebaseApp } from "./firebase";

export type BroadcastReach = { recipients: number; reachable: number };
export type BroadcastResult = BroadcastReach & { sent: number; failed: number };

async function call<T>(payload: { action: "preview" | "send"; text?: string; icon?: string }): Promise<T> {
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

/** `icon` is the sender's picture cut to a circle (a PNG data URL), so the notification shows it round. */
export const sendBroadcast = (text: string, icon?: string) => call<BroadcastResult>({ action: "send", text, ...(icon ? { icon } : {}) });

/** The picture as a transparent PNG with round edges, small enough for a notification icon. Empty when it cannot be made. */
export async function roundIcon(photoUrl?: string | null): Promise<string> {
  if (!photoUrl) return "";
  try {
    const image = new Image();
    image.src = photoUrl;
    await image.decode();
    const size = 192;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    context.clip();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    const png = canvas.toDataURL("image/png");
    return png.startsWith("data:image/png;base64,") && png.length <= 90000 ? png : "";
  } catch {
    return "";
  }
}
