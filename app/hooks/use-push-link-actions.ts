import { useEffect, useState } from "react";

const clearParams = (...keys: string[]) => {
  const url = new URL(window.location.href);
  keys.forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

type Options = {
  /** Signed in with the session verified. */
  ready: boolean;
  isBarber: boolean;
  isAdmin: boolean;
  /** "Sprawdź, czy rozliczyłeś": open the barber's end-of-day window. */
  onUnsettled: () => void;
  /** "Czas na kolejną wizytę": start a booking with this barber chosen. */
  onRebook: (barberId: string) => void;
};

/**
 * Two pushes open the app with an action in the link (?event=unsettled, ?event=rebook&barber=ID).
 * The action runs once the user is signed in, only for the role it was meant for, and the link is cleaned.
 */
export function usePushLinkActions({ ready, isBarber, isAdmin, onUnsettled, onRebook }: Options) {
  const [unsettled, setUnsettled] = useState(false);
  const [rebookBarberId, setRebookBarberId] = useState("");

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const event = params.get("event")?.trim();
    if (event === "unsettled") setUnsettled(true);
    if (event === "rebook") setRebookBarberId(params.get("barber")?.trim() ?? "");
  }, []);

  useEffect(() => {
    if (!unsettled || !ready) return;
    setUnsettled(false);
    clearParams("event");
    if (isBarber) onUnsettled();
  }, [isBarber, onUnsettled, ready, unsettled]);

  useEffect(() => {
    if (!rebookBarberId || !ready) return;
    setRebookBarberId("");
    clearParams("event", "barber");
    if (!isAdmin) onRebook(rebookBarberId);
  }, [isAdmin, onRebook, ready, rebookBarberId]);
}

type ReminderAnswerOptions = {
  /** Signed in with the session verified. */
  ready: boolean;
  uid: string;
  visits: Array<{ id: string; userId?: string; status?: string }>;
  /** "Potwierdzam": the client vouches for the visit. */
  onAttend: (appointmentId: string) => void;
  /** "Odwołuję": opens the usual cancellation question for the visit. */
  onCancel: (appointmentId: string) => void;
};

/**
 * The buttons of the visit reminder open the app on ?event=reminder&appointment=ID&reminder=confirm|cancel.
 * The answer is carried out once, as soon as that visit is loaded for the signed-in client.
 */
export function useReminderAnswer({ ready, uid, visits, onAttend, onCancel }: ReminderAnswerOptions) {
  const [answer, setAnswer] = useState<{ appointmentId: string; action: "confirm" | "cancel" } | null>(null);

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const appointmentId = params.get("appointment")?.trim();
    const action = params.get("reminder");
    if (appointmentId && params.get("event") === "reminder" && (action === "confirm" || action === "cancel")) {
      setAnswer({ appointmentId, action });
    }
  }, []);

  useEffect(() => {
    if (!answer || !uid || !ready) return;
    const visit = visits.find((item) => item.id === answer.appointmentId && item.userId === uid);
    if (!visit) return;
    setAnswer(null);
    if (["cancelled", "completed", "no_show"].includes(visit.status ?? "")) return;
    if (answer.action === "cancel") onCancel(visit.id);
    else if (visit.status === "confirmed") onAttend(visit.id);
    // The callbacks change every render; the answer is carried out once, guarded by the state above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, ready, uid, visits]);
}
