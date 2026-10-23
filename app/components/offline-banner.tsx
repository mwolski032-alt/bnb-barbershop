"use client";

import { CloudOff } from "lucide-react";

type Props = {
  online: boolean;
  /** Answers given offline that wait for the connection. */
  pendingCount: number;
  /** The list of visits comes from this device's memory, not from the server. */
  showingSavedData: boolean;
  /** One-off result of sending the queue (some answers no longer applied). */
  notice: string;
  onDismissNotice: () => void;
};

const pendingLabel = (count: number) =>
  count === 1 ? "1 odpowiedź czeka na wysłanie" : `${count} odpowiedzi czeka na wysłanie`;

export default function OfflineBanner({ online, pendingCount, showingSavedData, notice, onDismissNotice }: Props) {
  if (online && pendingCount === 0 && !notice && !showingSavedData) return null;

  if (online && pendingCount === 0 && !showingSavedData) {
    return (
      <div className="offline-banner notice" role="status">
        <span>{notice}</span>
        <button type="button" onClick={onDismissNotice}>OK</button>
      </div>
    );
  }

  return (
    <div className={`offline-banner${online ? " syncing" : ""}`} role="status" aria-live="polite">
      <CloudOff aria-hidden="true" />
      <span>
        {online && pendingCount > 0 ? "Wysyłam zapisane odpowiedzi…" : online ? "Nie udało się odświeżyć" : "Brak połączenia"}
        {showingSavedData ? " · pokazuję ostatnio zapisane wizyty" : ""}
        {pendingCount > 0 ? ` · ${pendingLabel(pendingCount)}` : ""}
      </span>
    </div>
  );
}
