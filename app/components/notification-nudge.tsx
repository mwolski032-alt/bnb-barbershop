"use client";
import { useEffect, useState } from "react";
import { Bell, BellRing, CalendarClock, Check, Sparkles } from "lucide-react";
import { isIosDevice, type NudgeKind } from "../hooks/use-notification-nudge";
import SalonDialog from "./salon-dialog";

type Props = {
  kind: NudgeKind;
  welcome: boolean;
  /** True once the device reports notifications as on: the dialog celebrates and closes itself. */
  enabled: boolean;
  busy: boolean;
  onEnable: () => void;
  onInstall: () => void;
  onClose: () => void;
};

const BENEFITS = [
  { icon: CalendarClock, text: "Przypomnienie o wizycie" },
  { icon: BellRing, text: "Zmiana terminu" },
  { icon: Sparkles, text: "Wolne miejsce" },
];

const UNBLOCK_STEPS = {
  ios: ["Otwórz Ustawienia telefonu i wybierz Powiadomienia.", "Znajdź na liście BNB Barber.", "Włącz „Zezwalaj na powiadomienia” i wróć do aplikacji."],
  other: ["Dotknij ikony kłódki obok adresu strony (albo przytrzymaj ikonę aplikacji, jeśli jest zainstalowana).", "Wybierz Uprawnienia, potem Powiadomienia.", "Zezwól na powiadomienia i wróć do aplikacji."],
};

/** The friendly "turn on notifications" dialog; the real browser question only follows the tap on its main button. */
export default function NotificationNudge({ kind, welcome, enabled, busy, onEnable, onInstall, onClose }: Props) {
  const [showSteps, setShowSteps] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setTimeout(onClose, 2000);
    return () => window.clearTimeout(timer);
  }, [enabled, onClose]);

  const copy = enabled
    ? { title: "Gotowe!", text: "Od teraz damy Ci znać o wszystkim, co ważne dla Twojej wizyty." }
    : kind === "blocked"
      ? { title: "Powiadomienia są zablokowane", text: "Odblokuj je w ustawieniach telefonu, a nie umknie Ci żadna zmiana terminu." }
      : kind === "install"
        ? { title: "Zainstaluj aplikację", text: "Na iPhonie powiadomienia działają tylko z aplikacji dodanej do ekranu początkowego." }
        : { title: welcome ? "Zacznij od powiadomień" : "Włącz powiadomienia", text: "Dzięki nim dostaniesz przypomnienie o wizycie i od razu dowiesz się, gdy barber zmieni termin albo zwolni się miejsce." };

  return <SalonDialog title="Powiadomienia" onClose={onClose} className="nudge-dialog">
    <div className={`nudge ${enabled ? "is-done" : ""}`}>
      <div className="nudge-stage" aria-hidden="true">
        <i /><i /><i />
        <span className="nudge-bell">{enabled ? <Check /> : <Bell />}</span>
      </div>
      {welcome && !enabled ? <span className="salon-overline">WITAJ W B&apos;N&apos;B</span> : null}
      <h2>{copy.title}</h2>
      <p>{copy.text}</p>
      {kind === "enable" && !enabled && <ul className="nudge-benefits">{BENEFITS.map(({ icon: Icon, text }) => <li key={text}><Icon aria-hidden="true" />{text}</li>)}</ul>}
      {kind === "blocked" && !enabled && showSteps && <ol className="nudge-steps">{UNBLOCK_STEPS[isIosDevice() ? "ios" : "other"].map(step => <li key={step}>{step}</li>)}</ol>}
      {!enabled && <div className="nudge-actions">
        {kind === "enable" && <button type="button" className="salon-cta" onClick={onEnable} disabled={busy} aria-busy={busy}>{busy ? "Włączam…" : "Włącz powiadomienia"}</button>}
        {kind === "blocked" && !showSteps && <button type="button" className="salon-cta" onClick={() => setShowSteps(true)}>Pokaż, jak odblokować</button>}
        {kind === "install" && <button type="button" className="salon-cta" onClick={onInstall}>Pokaż, jak zainstalować</button>}
        <button type="button" className="nudge-later" onClick={onClose}>Później</button>
      </div>}
    </div>
  </SalonDialog>;
}
