"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import UnsettledDialog from "../components/unsettled-dialog";
import type { AdminAppointment } from "../lib/booking-types";
import { canSettleAppointment, dayKey, getAppointmentPriceValue } from "../lib/booking-selectors";
import { confirmAction } from "../lib/confirm-action";
import {
  dismissUnsettledPrompt,
  getUnsettledVisits,
  isEndOfDay,
  wasUnsettledPromptDismissed,
} from "../lib/unsettled";

const formatMoney = (value: number) => `${value.toFixed(2).replace(/\.00$/, "").replace(".", ",")} zł`;

type Options = {
  /** The signed-in barber. The window is for barbers only, never for the owner or a client. */
  barberId: string | null;
  /** That barber's appointments. */
  appointments: AdminAppointment[];
  /** End of today's working hours ("18:00"), if the barber set any. */
  workEnd: string | undefined;
  now: Date;
  /** The barber's panel is open and its data has loaded. */
  ready: boolean;
  settlingId: string | null;
  busy: boolean;
  settle: (appointment: AdminAppointment) => Promise<void>;
  noShow: (appointment: AdminAppointment) => Promise<void>;
};

/**
 * End-of-day window "Nierozliczeni". It opens by itself once per day, an hour after the working hours end,
 * and only if a finished visit is still neither settled, marked as a no-show nor cancelled. The push
 * "Sprawdź, czy rozliczyłeś" opens it on demand through `openNow`.
 */
export function useEndOfDayPrompt({ barberId, appointments, workEnd, now, ready, settlingId, busy, settle, noShow }: Options) {
  const [open, setOpen] = useState(false);
  const todayKey = dayKey(now);
  const visits = useMemo(() => (barberId ? getUnsettledVisits(appointments, now) : []), [appointments, barberId, now]);
  const reached = isEndOfDay(appointments, workEnd, now);

  const close = useCallback(() => {
    setOpen(false);
    if (barberId) dismissUnsettledPrompt(barberId, dayKey(new Date()));
  }, [barberId]);
  const openNow = useCallback(() => setOpen(true), []);

  useEffect(() => {
    if (!barberId || !ready || open || !reached || visits.length === 0) return;
    if (wasUnsettledPromptDismissed(barberId, todayKey)) return;
    setOpen(true);
  }, [barberId, open, ready, reached, todayKey, visits.length]);

  const settleAll = async () => {
    const list = visits.filter((appointment) => canSettleAppointment(appointment, now));
    if (list.length === 0) return;
    const total = list.reduce((sum, appointment) => sum + (getAppointmentPriceValue(appointment) || 0), 0);
    if (!(await confirmAction({
      title: list.length === 1 ? "Rozliczyć tę wizytę?" : `Rozliczyć ${list.length} wizyt?`,
      message: `Zostaną rozliczone według cen z kalendarza, razem ${formatMoney(total)}.`,
      confirmLabel: "Rozlicz",
    }))) return;
    for (const appointment of list) await settle(appointment);
  };

  const dialog: ReactNode = open && ready ? (
    <UnsettledDialog
      visits={visits}
      settlingId={settlingId}
      busy={busy}
      onSettle={(appointment) => void settle(appointment)}
      onNoShow={(appointment) => void noShow(appointment)}
      onSettleAll={() => void settleAll()}
      onClose={close}
    />
  ) : null;

  return { open: open && ready, openNow, close, dialog };
}
