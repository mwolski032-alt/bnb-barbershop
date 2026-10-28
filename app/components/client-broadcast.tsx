"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, Check, ChevronDown, Send, Users } from "lucide-react";
import { BROADCAST_MAX_CHARS } from "../../shared/broadcast.mjs";
import { useCountUp } from "../hooks/use-count-up";
import { previewBroadcast, roundIcon, sendBroadcast, type BroadcastPerson, type BroadcastReach, type BroadcastResult } from "../lib/broadcast-api";
import { confirmAction } from "../lib/confirm-action";
import ProfileAvatar from "./profile-avatar";
import SalonDialog from "./salon-dialog";

type Props = {
  /** What the client reads as the sender: the barber's name, or the company for the owner. */
  senderName: string;
  senderPhotoUrl?: string | null;
  /** The owner writes as the company: the logo stands in for a picture. */
  asCompany?: boolean;
  onClose: () => void;
};

const people = (count: number) => (count === 1 ? "osoba" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? "osoby" : "osób");

function Reach({ reach, selected }: { reach: BroadcastReach; selected: number }) {
  const counted = useCountUp(selected, { duration: 700 });
  return <>
    <strong>{counted}</strong>
    <span>
      {reach.reachable === 0 ? "Nikt nie ma jeszcze włączonych powiadomień" : selected === 0 ? "Nikt nie jest zaznaczony" : <>{people(selected)} {selected === 1 ? "dostanie" : "dostaną"} powiadomienie</>}
      {reach.reachable > 0 && selected < reach.reachable && <small>Odznaczono {reach.reachable - selected}</small>}
      {reach.reachable > 0 && selected === reach.reachable && reach.recipients > reach.reachable && <small>{reach.recipients} klientów w sumie, reszta nie włączyła powiadomień</small>}
    </span>
    <ChevronDown className="broadcast-reach-chevron" aria-hidden="true" />
  </>;
}

const personPhoto = (person: BroadcastPerson) =>
  person.photoVersion ? `/api/client-photo/${encodeURIComponent(person.uid)}?v=${person.photoVersion}` : null;

/** "Napisz do klientów": one hand-written push, shown to the writer exactly as the client will see it. */
export default function ClientBroadcast(props: Props) {
  const [text, setText] = useState("");
  const [reach, setReach] = useState<BroadcastReach | null>(null);
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [listOpen, setListOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const everyone = reach?.people ?? [];
  const reachablePeople = everyone.filter((person) => person.reachable);
  const unreachablePeople = everyone.filter((person) => !person.reachable);
  const selected = reachablePeople.filter((person) => !excluded.has(person.uid)).length;
  const toggle = (uid: string) => setExcluded((current) => {
    const next = new Set(current);
    if (!next.delete(uid)) next.add(uid);
    return next;
  });
  const message = text.trim();
  const left = BROADCAST_MAX_CHARS - text.length;
  const avatarPhoto = props.asCompany ? "/icons/icon-192.png" : props.senderPhotoUrl;

  useEffect(() => {
    let active = true;
    previewBroadcast()
      .then((value) => { if (active) setReach(value); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "Nie udało się sprawdzić zasięgu."); });
    return () => { active = false; };
  }, []);

  async function send() {
    if (!message || state !== "idle" || !reach || selected === 0) return;
    const confirmed = await confirmAction({
      title: `Wysłać do ${selected} ${people(selected)}?`,
      message: "Wiadomości nie da się cofnąć ani poprawić po wysłaniu. Sprawdź jeszcze raz treść w podglądzie.",
      confirmLabel: "Wyślij", cancelLabel: "Wróć do treści",
    });
    if (!confirmed) { area.current?.focus(); return; }
    setState("sending"); setError("");
    try {
      setResult(await sendBroadcast(message, props.asCompany ? "" : await roundIcon(props.senderPhotoUrl), reachablePeople.filter((person) => excluded.has(person.uid)).map((person) => person.uid)));
      setState("sent");
    } catch (failure) {
      setState("idle");
      setError(failure instanceof Error ? failure.message : "Nie udało się wysłać wiadomości.");
    }
  }

  return <SalonDialog title="Napisz do klientów" onClose={props.onClose} className="broadcast-dialog">
    {(close) => <div className={`broadcast-card ${state}`}>
      <div className="broadcast-hero" aria-hidden="true"><i /><i /><i /></div>
      <header className="broadcast-head">
        <span className="salon-overline">NAPISZ DO KLIENTÓW</span>
        <h2>Jako {props.senderName}</h2>
        <p>{props.asCompany ? "Wiadomość dostaną wszyscy klienci salonu." : "Dostaną ją klienci, którzy byli u Ciebie, i ci, którzy wybrali Cię jako ulubionego barbera."}</p>
      </header>

      {state === "sent" && result ? <div className="broadcast-done" role="status">
        <span className="broadcast-done-plane" aria-hidden="true"><Send /></span>
        <span className="broadcast-done-check" aria-hidden="true"><Check /></span>
        <h3>Wysłane</h3>
        <p>{result.sent === 0 ? "Żadne urządzenie nie odebrało wiadomości. Spróbuj za chwilę." : <>Dotarło na {result.sent} {result.sent === 1 ? "urządzenie" : "urządzeń"} ({result.reachable} {people(result.reachable)}).</>}</p>
        <button type="button" className="salon-cta" onClick={close}>Gotowe</button>
      </div> : <>
        <div className="broadcast-recipients">
          {reach ? <button type="button" className="broadcast-reach" aria-expanded={listOpen} aria-controls="broadcast-people" disabled={everyone.length === 0} onClick={() => setListOpen((open) => !open)}>
            <Users aria-hidden="true" /><Reach reach={reach} selected={selected} />
          </button> : <div className="broadcast-reach" aria-live="polite">
            {error ? null : <><Users aria-hidden="true" /><span className="broadcast-reach-loading">Sprawdzam, do ilu osób dotrze…</span></>}
          </div>}
          <div className="broadcast-people" id="broadcast-people" data-open={listOpen || undefined}>
            <div className="broadcast-people-inner">
              <div className="broadcast-people-tools">
                <span>Odznacz osoby, które nie mają dostać wiadomości.</span>
                <button type="button" onClick={() => setExcluded(excluded.size === 0 ? new Set(reachablePeople.map((person) => person.uid)) : new Set())}>
                  {excluded.size === 0 ? "Odznacz wszystkich" : "Zaznacz wszystkich"}
                </button>
              </div>
              <ul>
                {reachablePeople.map((person) => <li key={person.uid}>
                  <label>
                    <input type="checkbox" checked={!excluded.has(person.uid)} onChange={() => toggle(person.uid)} disabled={state === "sending"} />
                    <i aria-hidden="true"><Check /></i>
                    <ProfileAvatar className="broadcast-person-avatar" name={person.name} photoUrl={personPhoto(person)} />
                    <span>{person.name}</span>
                  </label>
                </li>)}
              </ul>
              {unreachablePeople.length > 0 && <>
                <p className="broadcast-people-note">Bez powiadomień ({unreachablePeople.length}). Wiadomość do nich nie dotrze.</p>
                <ul className="muted">
                  {unreachablePeople.map((person) => <li key={person.uid}><span className="broadcast-person-off">
                    <ProfileAvatar className="broadcast-person-avatar" name={person.name} photoUrl={personPhoto(person)} />
                    <span>{person.name}</span>
                  </span></li>)}
                </ul>
              </>}
            </div>
          </div>
        </div>

        <label className="broadcast-field">Treść wiadomości
          <textarea ref={area} value={text} maxLength={BROADCAST_MAX_CHARS} rows={4} autoFocus disabled={state === "sending"}
            placeholder="Napisz, co chcesz przekazać klientom…" onChange={(event) => setText(event.target.value)} />
          <span className={`broadcast-count ${left <= 20 ? "low" : ""}`} aria-live="polite">{left}</span>
        </label>

        <section className="broadcast-preview" aria-label="Podgląd powiadomienia">
          <p className="broadcast-preview-label"><Bell aria-hidden="true" /> Tak zobaczy to klient</p>
          <div className="broadcast-phone">
            <div className={`broadcast-push ${message ? "typed" : ""}`}>
              <ProfileAvatar className="broadcast-push-avatar" name={props.senderName} photoUrl={avatarPhoto} />
              <div>
                <p className="broadcast-push-top"><strong>{props.senderName}</strong><span>teraz</span></p>
                <p key={message ? "text" : "empty"} className="broadcast-push-body">{message || "Tu pojawi się treść Twojej wiadomości."}</p>
              </div>
            </div>
          </div>
        </section>

        {error && <p className="salon-feedback error" role="alert">{error}</p>}
        <button type="button" className="salon-cta broadcast-send" onClick={() => void send()}
          disabled={!message || state === "sending" || !reach || selected === 0}>
          <Send aria-hidden="true" /> {state === "sending" ? "Wysyłam…" : "Wyślij do klientów"}
        </button>
      </>}
    </div>}
  </SalonDialog>;
}
