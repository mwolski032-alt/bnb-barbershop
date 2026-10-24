// The owner's error monitor can copy its list as plain text, to paste into a message. Pure, covered by tests.

export const ERROR_TYPE_LABELS = {
  javascript: "Błąd aplikacji",
  promise: "Operacja w tle",
  resource: "Ładowanie pliku",
  network: "Połączenie z serwerem",
  react: "Widok aplikacji",
};

const STACK_LINES = 6;

const formatWhen = (value) => {
  const date = new Date(Number(value) || 0);
  if (Number.isNaN(date.getTime()) || !date.getTime()) return "brak";
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

/**
 * One block per error, most frequent first. The messages are already stripped of names, phone numbers and
 * e-mail addresses on the server, so the text is safe to share. The stack is cut to its first lines.
 */
export const formatErrorReportsText = (reports, { now = Date.now(), scope = "aktywne" } = {}) => {
  const list = [...(reports ?? [])].sort(
    (first, second) => (Number(second.count) || 0) - (Number(first.count) || 0) || (second.lastSeenAt || 0) - (first.lastSeenAt || 0),
  );
  const occurrences = list.reduce((sum, report) => sum + (Number(report.count) || 0), 0);
  const lines = [`Błędy aplikacji BNB (${scope}), stan na ${formatWhen(now)}`, `Zgłoszeń: ${list.length}, wystąpień: ${occurrences}`];

  list.forEach((report, index) => {
    const device = report.device ?? {};
    const stack = String(report.stack ?? "").split("\n").slice(0, STACK_LINES).join("\n").trim();
    lines.push(
      "",
      `${index + 1}. [${ERROR_TYPE_LABELS[report.type] ?? "Błąd aplikacji"}] ${report.count}× ${report.resolvedAt ? "(rozwiązany)" : ""}`.trimEnd(),
      `Treść: ${report.message}`,
      `Urządzenie: ${device.os ?? "?"}, ${device.browser ?? "?"}, ${device.viewport ?? "?"}${device.installed ? ", zainstalowana aplikacja" : ""}, ${device.online === false ? "offline" : device.connection ?? "?"}`,
      `Ekran: ${report.screen ?? "?"}, adres: ${report.route ?? "/"}`,
      `Pierwszy raz: ${formatWhen(report.firstSeenAt)}, ostatni raz: ${formatWhen(report.lastSeenAt)}, wersja: ${String(report.release ?? "").slice(0, 8) || "?"}`,
      ...(stack ? ["Ślad:", stack] : []),
    );
  });
  return lines.join("\n");
};
