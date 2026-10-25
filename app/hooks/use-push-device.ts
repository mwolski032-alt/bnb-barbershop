import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ActionFeedback, WorkFeedback } from "../lib/booking-types";
import { pushDeviceStatusLabel } from "../lib/booking-labels";
import {
  disablePushNotifications,
  getPushNotificationDeviceStatus,
  isPushNotificationsLocallyDisabled,
  registerPushNotifications,
  type PushDeviceStatus,
} from "../lib/notifications";

type SignedInUser = { uid: string; displayName?: string | null; email?: string | null };
type ActionFeedbackSetter = Dispatch<SetStateAction<ActionFeedback | null>>;

/**
 * Everything about this device's push notifications for the signed-in person: the current status, turning them
 * on and off, registering the device when permission is already granted, and the short feedback messages.
 */
export function usePushDevice({ activeUser, isOwner, isAdmin, setActionFeedback }: {
  activeUser: SignedInUser | null;
  isOwner: boolean;
  isAdmin: boolean;
  setActionFeedback: ActionFeedbackSetter;
}) {
  const [pushDeviceStatus, setPushDeviceStatus] = useState<PushDeviceStatus>("checking");
  const [isPushDeviceUpdating, setIsPushDeviceUpdating] = useState(false);
  const [pushDeviceFeedback, setPushDeviceFeedback] = useState<WorkFeedback | null>(null);

  const pushDeviceEnabled = pushDeviceStatus === "enabled";
  const pushDeviceLabel = pushDeviceStatusLabel[pushDeviceStatus];

  const registerCurrentPushDevice = useCallback(async () => {
    if (!activeUser || isOwner) return null;

    const result = await registerPushNotifications(
      {
        uid: activeUser.uid,
        displayName: activeUser.displayName ?? null,
        email: activeUser.email ?? null,
      },
      isAdmin,
    ).catch(() => ({ ok: false as const, reason: "token_error" as const }));
    setPushDeviceStatus(
      result.ok
        ? "enabled"
        : result.reason === "unsupported_browser" ||
            result.reason === "unsupported_firebase_messaging"
          ? "unsupported"
          : result.reason === "permission_denied" && Notification.permission === "denied"
            ? "blocked"
            : "error",
    );
    return result;
  }, [activeUser, isAdmin, isOwner]);

  useEffect(() => {
    if (!activeUser || isOwner) {
      setPushDeviceStatus("checking");
      setPushDeviceFeedback(null);
      return undefined;
    }

    let stopped = false;
    const notificationUser = {
      uid: activeUser.uid,
      displayName: activeUser.displayName ?? null,
      email: activeUser.email ?? null,
    };
    const refreshStatus = async () => {
      const status = await getPushNotificationDeviceStatus(notificationUser);
      if (!stopped) setPushDeviceStatus(status);
    };
    const refreshAfterReturn = () => {
      if (document.visibilityState === "visible") void refreshStatus();
    };

    setPushDeviceStatus("checking");
    void refreshStatus();
    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", refreshAfterReturn);

    return () => {
      stopped = true;
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", refreshAfterReturn);
    };
  }, [activeUser, isOwner]);

  useEffect(() => {
    if (!pushDeviceFeedback) return undefined;
    const timeoutId = window.setTimeout(() => setPushDeviceFeedback(null), 4500);
    return () => window.clearTimeout(timeoutId);
  }, [pushDeviceFeedback]);

  useEffect(() => {
    if (isPushDeviceUpdating) {
      setActionFeedback({
        key: "push_device",
        kind: "pending",
        message: "Aktualizuję powiadomienia…",
      });
      return;
    }
    if (pushDeviceFeedback) {
      setActionFeedback({ key: "push_device", ...pushDeviceFeedback });
    }
  }, [isPushDeviceUpdating, pushDeviceFeedback, setActionFeedback]);

  useEffect(() => {
    if (
      !activeUser ||
      isOwner ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted" ||
      isPushNotificationsLocallyDisabled(activeUser.uid)
    ) {
      return;
    }

    void registerCurrentPushDevice();
  }, [activeUser, isOwner, registerCurrentPushDevice]);

  const handlePushDeviceToggle = async () => {
    if (!activeUser || isOwner || isPushDeviceUpdating || pushDeviceStatus === "checking") return;

    setIsPushDeviceUpdating(true);
    setPushDeviceFeedback(null);
    const notificationUser = {
      uid: activeUser.uid,
      displayName: activeUser.displayName ?? null,
      email: activeUser.email ?? null,
    };

    try {
      if (pushDeviceEnabled) {
        const result = await disablePushNotifications(notificationUser);
        if (!result.ok) {
          setPushDeviceStatus("error");
          setPushDeviceFeedback({
            kind: "error",
            message: "Nie udało się wyłączyć powiadomień. Spróbuj ponownie.",
          });
          return;
        }
        setPushDeviceStatus("disabled");
        setPushDeviceFeedback({
          kind: "success",
          message: "Powiadomienia na tym urządzeniu są wyłączone.",
        });
        return;
      }

      if (
        pushDeviceStatus === "blocked" ||
        (typeof Notification !== "undefined" && Notification.permission === "denied")
      ) {
        setPushDeviceStatus("blocked");
        setPushDeviceFeedback({
          kind: "error",
          message: "Odblokuj powiadomienia dla BNB Barbershop w ustawieniach telefonu.",
        });
        return;
      }

      if (pushDeviceStatus === "unsupported") {
        setPushDeviceFeedback({
          kind: "error",
          message:
            "Ta przeglądarka nie obsługuje powiadomień. Na iPhonie dodaj aplikację do ekranu początkowego.",
        });
        return;
      }

      const result = await registerCurrentPushDevice();
      if (!result?.ok) {
        setPushDeviceFeedback({
          kind: "error",
          message:
            result?.reason === "permission_denied"
              ? typeof Notification !== "undefined" && Notification.permission === "denied"
                ? "Powiadomienia zostały zablokowane. Włącz je w ustawieniach telefonu."
                : "Zezwól na powiadomienia w komunikacie systemowym."
              : "Nie udało się włączyć powiadomień. Spróbuj ponownie.",
        });
        return;
      }

      setPushDeviceFeedback({
        kind: "success",
        message: "Powiadomienia na tym urządzeniu są włączone.",
      });
    } finally {
      setIsPushDeviceUpdating(false);
    }
  };

  return { pushDeviceStatus, isPushDeviceUpdating, pushDeviceFeedback, pushDeviceEnabled, pushDeviceLabel, registerCurrentPushDevice, handlePushDeviceToggle };
}
