"use client";

import { useState } from "react";
import { fetchClientMergePreview, type ClientMergePreview } from "../lib/appointments";

type Client = { id: string; name: string; email: string; phone: string; userId?: string };
type Props = {
  current: Client;
  clients: Client[];
  onMerge: (preview: ClientMergePreview) => Promise<void>;
};

const phoneDigits = (value: string) => value.replace(/\D/g, "").replace(/^48(?=\d{9}$)/, "");
const samePhone = (a: Client, b: Client) =>
  phoneDigits(a.phone).length === 9 && phoneDigits(a.phone) === phoneDigits(b.phone);

export default function ClientMergePanel({ current, clients, onMerge }: Props) {
  const manualClients = clients.filter(client => !client.userId);
  const accountClients = clients.filter(client => client.userId && client.userId === client.id);
  const candidates = (current.userId ? manualClients : accountClients)
    .filter(client => client.id !== current.id && samePhone(current, client));
  const [expanded, setExpanded] = useState(false);
  const [sourceId, setSourceId] = useState(current.userId ? "" : current.id);
  const [targetId, setTargetId] = useState(current.userId ? current.id : "");
  const [preview, setPreview] = useState<ClientMergePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const resetPreview = () => { setPreview(null); setConfirmed(false); setError(""); };
  const inspect = async () => {
    if (busy || !sourceId || !targetId) return;
    setBusy(true);
    resetPreview();
    try { setPreview(await fetchClientMergePreview(sourceId, targetId)); }
    catch (error) { setError(error instanceof Error ? error.message : "Nie udało się sprawdzić kart."); }
    finally { setBusy(false); }
  };
  const merge = async () => {
    if (!preview || !confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await onMerge(preview);
      setPreview(null);
      setConfirmed(false);
      setExpanded(false);
      setSourceId("");
    }
    catch (error) {
      setError(error instanceof Error ? error.message : "Nie udało się scalić klientów.");
      setPreview(null);
      setConfirmed(false);
    } finally { setBusy(false); }
  };
  const optionLabel = (client: Client) =>
    `${client.name} · ${client.email || "bez e-maila"} · ${client.phone || "bez telefonu"}`;

  return (
    <section className="client-merge-panel" aria-label="Scalanie klientów">
      <strong>{candidates.length ? `Znaleziono podobne karty: ${candidates.length}` : "Scalanie klientów"}</strong>
      <p>{candidates.length
        ? "Ten sam numer telefonu występuje na innej karcie. Sprawdź dane i potwierdź, czy to ta sama osoba."
        : "Połącz ręczną kartę z kontem Google klienta, aby zebrać jego wizyty w jednej historii."}</p>
      <button type="button" aria-expanded={expanded} disabled={busy} onClick={() => setExpanded(!expanded)}>
        {expanded ? "Zwiń scalanie" : "Scal klientów"}
      </button>
      {expanded ? <div className="client-merge-form">
        {manualClients.length === 0 || accountClients.length === 0 ? <p>
          Potrzebna jest ręczna karta i karta zalogowanego klienta. Konto Google pojawi się w Twojej bazie po rezerwacji klienta.
        </p> : <>
          <label>Ręczna karta do połączenia
            <select value={sourceId} disabled={busy} onChange={event => {setSourceId(event.target.value); resetPreview();}}>
              <option value="">Wybierz ręczną kartę</option>
              {manualClients.map(client => <option key={client.id} value={client.id}>
                {optionLabel(client)}{candidates.some(c => c.id === client.id) ? " — zgodny telefon" : ""}
              </option>)}
            </select>
          </label>
          <label>Konto Google, które pozostanie
            <select value={targetId} disabled={busy} onChange={event => {setTargetId(event.target.value); resetPreview();}}>
              <option value="">Wybierz konto docelowe</option>
              {accountClients.map(client => <option key={client.id} value={client.id}>
                {optionLabel(client)}{candidates.some(c => c.id === client.id) ? " — zgodny telefon" : ""}
              </option>)}
            </select>
          </label>
          <button type="button" disabled={busy || !sourceId || !targetId} aria-busy={busy && !preview} onClick={() => void inspect()}>
            Sprawdź scalenie
          </button>
          {preview ? <div className="client-merge-preview" aria-live="polite">
            <p><strong>{preview.source.name}</strong> zostanie połączony z kontem <strong>{preview.target.name}</strong> ({preview.target.email}).</p>
            <p>Przeniesiemy wizyty: <strong>{preview.appointmentCount}</strong>{preview.waitlistCount ? ` oraz wpisy na liście rezerwowej: ${preview.waitlistCount}` : ""}. Kwoty rozliczeń pozostaną bez zmian. Historia będzie widoczna na wybranym koncie Google, a ręczna karta zniknie z kartoteki.</p>
            {!preview.samePhone ? <p>Numery telefonu są różne. Sprawdź tożsamość klienta przed połączeniem.</p> : null}
            <label className="client-merge-confirm">
              <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
              Potwierdzam, że obie karty należą do tej samej osoby i wybrałem właściwe konto Google.
            </label>
            <button type="button" disabled={busy || !confirmed} aria-busy={busy} onClick={() => void merge()}>
              Zatwierdź scalenie
            </button>
          </div> : null}
          {error ? <p role="alert" className="client-merge-error">{error}</p> : null}
        </>}
      </div> : null}
    </section>
  );
}
