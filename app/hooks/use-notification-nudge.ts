import { useCallback, useEffect, useState } from "react";
import type { PushDeviceStatus } from "../lib/notifications";

export type NudgeKind = "enable" | "blocked" | "install";

const DISMISSED_KEY = "bnb-push-nudge-dismissed";
const SEEN_KEY = "bnb-push-nudge-seen";
const SHOW_DELAY_MS = 1400;

const safe = <T,>(read: () => T, fallback: T) => { try { return read(); } catch { return fallback; } };

export const isIosDevice = () =>
  typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/**
 * Decides when to ask a signed-in person to turn notifications on: shortly after every launch while they are off
 * (a "later" only lasts until the app is closed), and with a welcome wording the very first time.
 * The browser only allows the real permission question after a tap, so this just opens our own dialog.
 */
export function useNotificationNudge({ ready, status }: { ready: boolean; status: PushDeviceStatus }) {
  const [open, setOpen] = useState(false);
  const [welcome, setWelcome] = useState(false);
  // Once notifications turn on, `kind` goes null; the open dialog keeps the one it opened with so it can celebrate.
  const [shownKind, setShownKind] = useState<NudgeKind | null>(null);
  const kind: NudgeKind | null =
    status === "disabled" ? "enable"
    : status === "blocked" ? "blocked"
    : status === "unsupported" && isIosDevice() && !isStandalone() ? "install"
    : null;

  useEffect(() => {
    if (!ready || !kind || open) return undefined;
    if (safe(() => sessionStorage.getItem(DISMISSED_KEY) === "1", false)) return undefined;
    const timer = window.setTimeout(() => {
      setWelcome(!safe(() => localStorage.getItem(SEEN_KEY) === "1", true));
      safe(() => localStorage.setItem(SEEN_KEY, "1"), undefined);
      setShownKind(kind);
      setOpen(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, kind, open]);

  const dismiss = useCallback(() => {
    safe(() => sessionStorage.setItem(DISMISSED_KEY, "1"), undefined);
    setOpen(false);
  }, []);

  return { open, kind: shownKind, welcome, dismiss };
}
