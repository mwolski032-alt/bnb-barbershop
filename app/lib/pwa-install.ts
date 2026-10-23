import type { InstallPlatform } from "./booking-types";

export type DeferredInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export const isAppleMobileDevice = (navigatorValue: Navigator) =>
  /iPad|iPhone|iPod/i.test(navigatorValue.userAgent) ||
  (navigatorValue.platform === "MacIntel" && navigatorValue.maxTouchPoints > 1);

export const detectInstallPlatform = (): InstallPlatform =>
  isAppleMobileDevice(window.navigator) ? "ios" : "android";

export const isRunningAsInstalledApp = () => {
  const standaloneNavigator = window.navigator as Navigator & { standalone?: boolean };
  return (
    standaloneNavigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
};
