"use client";

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALLED_KEY = "bnb-pwa-installed";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosDevice() {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as Macintosh with touch support.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export type PwaInstall = {
  /** False once the app is installed (or running as an installed app). */
  canInstall: boolean;
  /** True on iPhone/iPad, where installation can only be explained, not triggered. */
  isIos: boolean;
  /** Triggers the native install prompt. Resolves false when it is not available. */
  promptInstall: () => Promise<boolean>;
};

export function usePwaInstall(): PwaInstall {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(true); // hidden until the client check runs
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    let wasInstalled = false;
    try {
      wasInstalled = window.localStorage.getItem(INSTALLED_KEY) === "1";
    } catch {}
    if (isStandalone()) {
      try {
        window.localStorage.setItem(INSTALLED_KEY, "1");
      } catch {}
      wasInstalled = true;
    }
    setIsIos(isIosDevice());
    setInstalled(wasInstalled);

    const markInstalled = () => {
      try {
        window.localStorage.setItem(INSTALLED_KEY, "1");
      } catch {}
      setDeferred(null);
      setInstalled(true);
    };
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === "accepted") {
      try {
        window.localStorage.setItem(INSTALLED_KEY, "1");
      } catch {}
      setInstalled(true);
    }
    return true;
  }, [deferred]);

  return { canInstall: !installed, isIos, promptInstall };
}
