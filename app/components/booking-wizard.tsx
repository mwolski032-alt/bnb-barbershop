"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X, Clock3, CalendarDays } from "lucide-react";
import ProfileAvatar from "./profile-avatar";
import type { DayCell, FormState, Service } from "../lib/booking-types";

type Barber = { id: string; name: string; photoUrl?: string; bio?: string; label: string };
export type BookingWizardProps = {
  barbers: Barber[]; barberId: string | null; services: Service[]; serviceId: string;
  days: DayCell[]; dateKey: string; month: Date; times: string[]; time: string;
  form: FormState; catalogReady: boolean; calendarReady: boolean; canPreviousMonth: boolean;
  canConfirm: boolean; busy: boolean; refreshing: boolean; error: string;
  step?: number; initialStep?: number; rescheduling?: boolean; price?: string;
  nearest: { date: Date; time: string } | null;
  onBarber: (id: string) => void; onService: (id: string) => void;
  onDay: (key: string) => void; onTime: (time: string) => void;
  onMonth: (direction: -1 | 1) => void; onForm: (field: keyof FormState, value: string) => void;
  onConfirm: () => Promise<void>; onClose: () => void; onRetry: () => Promise<void>;
  onNearest: () => void; onWaitlist: () => void;
  onStepChange?: (step: number) => void;
  overlayOpen?: boolean; onOverlayBack?: () => void;
};
const steps = ["Barber", "Usługa", "Dzień", "Godzina", "Twoje dane", "Potwierdzenie"];
const titles = ["W dobrych rękach.", "Czego dziś potrzebujesz?", "Znajdź dzień dla siebie.", "O której się widzimy?", "Jeszcze kilka szczegółów.", "Wszystko się zgadza?"];
const descriptions = ["Wybierz osobę, której powierzysz swój styl.", "Wybierz usługę z oferty Twojego barbera.", "Zaznaczone dni mają dostępne terminy.", "Wybierz jedną z dostępnych godzin.", "Te dane pozwolą nam potwierdzić Twoją wizytę.", "Sprawdź szczegóły przed zarezerwowaniem terminu."];
const keyFor = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const dateLabel = (key: string) => {
  const [y,m,d] = key.split("-").map(Number);
  return y && m && d ? new Intl.DateTimeFormat("pl-PL",{day:"numeric",month:"long",year:"numeric"}).format(new Date(y,m-1,d)) : "Wybierz dzień";
};

export default function BookingWizard(props: BookingWizardProps) {
  const { onStepChange } = props;
  const [internalStep, setInternalStep] = useState(props.initialStep ?? 0);
  const step = typeof props.step === "number" ? Math.max(0, Math.min(5, props.step)) : internalStep;
  const setCurrentStep = useCallback((next: number) => {
    const normalized = Math.max(0, Math.min(5, next));
    if (onStepChange) onStepChange(normalized);
    else setInternalStep(normalized);
  }, [onStepChange]);
  const [offline, setOffline] = useState(false);
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState("");
  const submitLock = useRef(false);
  const navLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const latest = useRef({ step, busy: props.busy || sending, onClose: props.onClose, overlayOpen: props.overlayOpen, onOverlayBack: props.onOverlayBack });
  useEffect(() => { latest.current = { step, busy: props.busy || sending, onClose: props.onClose, overlayOpen: props.overlayOpen, onOverlayBack: props.onOverlayBack }; }, [step, props.busy, sending, props.onClose, props.overlayOpen, props.onOverlayBack]);
  const barber = props.barbers.find(item => item.id === props.barberId);
  const service = props.services.find(item => item.id === props.serviceId);
  const validDetails = props.form.fullName.trim().length >= 3 && props.form.phone.replace(/\D/g, "").length === 9;
  const selectionValid = Boolean(barber && service && props.dateKey && props.time && props.times.includes(props.time));
  const busy = props.busy || sending;

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update(); window.addEventListener("online",update); window.addEventListener("offline",update);
    return () => { window.removeEventListener("online",update); window.removeEventListener("offline",update); };
  }, []);
  useEffect(() => {
    // Keep one wizard entry. Each browser/Android Back pops it, goes one step
    // back and restores the entry; closing at step one returns to the salon.
    // No user details are placed in URLs or browser-history state.
    const push = () => window.history.pushState({ bnbWizard: true }, "", "#rezerwacja");
    // Defer the entry so React StrictMode's probe mount cannot pop real history.
    let ownsEntry = false;
    const timer = window.setTimeout(() => { push(); ownsEntry = true; }, 0);
    const back = () => {
      if (latest.current.busy) { push(); return; }
      if (latest.current.overlayOpen) { latest.current.onOverlayBack?.(); push(); return; }
      if (latest.current.step > 0) { setCurrentStep(latest.current.step - 1); push(); }
      else latest.current.onClose();
    };
    window.addEventListener("popstate",back);
    return () => {
      window.removeEventListener("popstate",back);
      window.clearTimeout(timer);
      if (ownsEntry && window.history.state?.bnbWizard) window.history.back();
    };
  }, [setCurrentStep]);
  useEffect(() => {
    navLock.current = false;
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);
  const go = (next: number) => {
    if (busy || navLock.current || next === step) return;
    navLock.current = true;
    setLocalError(""); setCurrentStep(next);
  };
  async function confirm() {
    if (submitLock.current || busy || offline || !props.canConfirm || !selectionValid) return;
    submitLock.current = true; setSending(true); setLocalError("");
    try { await props.onConfirm(); }
    catch { setLocalError("Nie udało się potwierdzić wizyty. Spróbuj ponownie."); }
    finally { submitLock.current = false; setSending(false); }
  }
  return <section className="booking-story" aria-label="Kreator rezerwacji">
    <header className="story-header">
      <div className="story-toolbar">
        <button type="button" onClick={() => step ? go(step - 1) : props.onClose()} disabled={busy} aria-label="Wstecz"><ArrowLeft /></button>
        <span>B&apos;n&apos;B <small>REZERWACJA</small></span>
        <button type="button" onClick={props.onClose} disabled={busy} aria-label="Zamknij kreator"><X /></button>
      </div>
      <ol className="story-progress" aria-label={`Krok ${step+1} z 6: ${steps[step]}`}>
        {steps.map((label,index) => <li key={label} className={index < step ? "done" : index === step ? "current" : ""} aria-current={index === step ? "step" : undefined}><span className="story-segment" /><span className="story-step-label">{label}</span></li>)}
      </ol>
    </header>
    <div className="story-body">
      <div className="story-heading"><span className="salon-overline">{String(step+1).padStart(2,"0")} / 06 · {steps[step]}</span><h1 ref={heading} tabIndex={-1}>{titles[step]}</h1><p>{descriptions[step]}</p></div>
      {offline && <p className="story-notice" role="status">Jesteś offline. Twoje wybory pozostają tutaj. Połącz się z internetem, aby potwierdzić wizytę.</p>}
      <div key={step} className="story-scene">
        {step === 0 && <div className="story-options">{props.barbers.map(item => <button className={`story-barber ${item.id === props.barberId ? "selected" : ""}`} type="button" key={item.id} aria-pressed={item.id === props.barberId} onClick={() => { if (!navLock.current) { props.onBarber(item.id); go(1); } }} disabled={busy || Boolean(props.rescheduling && item.id !== props.barberId)}>
          <ProfileAvatar className="story-avatar" name={item.name} photoUrl={item.photoUrl} /><span><small>{item.label}</small><strong>{item.name}</strong>{item.bio && <em>{item.bio}</em>}</span><ArrowRight aria-hidden="true" />
        </button>)}{!props.barbers.length && <p role="status">Nie ma obecnie barberów dostępnych do rezerwacji.</p>}</div>}
        {step === 1 && <><div className="story-options">{props.catalogReady ? props.services.map(item => <button type="button" key={item.id} className={`story-service ${props.serviceId === item.id ? "selected" : ""}`} aria-pressed={props.serviceId === item.id} onClick={() => { if (!navLock.current) { props.onService(item.id); go(2); } }} disabled={busy || Boolean(props.rescheduling && item.id !== props.serviceId)}>
          <span><strong>{item.name}</strong><small><Clock3 aria-hidden="true" />{item.durationMinutes} min</small></span><b>{item.price}</b>
        </button>) : <div className="story-card-skeletons" role="status" aria-label="Wczytujemy usługi">{[0,1,2].map(item=><span className="story-card-skeleton skeleton-block" key={item} aria-hidden="true" />)}</div>}</div>{props.catalogReady && !props.services.length && <p role="status">Ten barber nie ma jeszcze dostępnych usług. Wybierz innego barbera.</p>}</>}
        {step === 2 && <>
          <div className="story-calendar"><div className="story-month"><button type="button" aria-label="Poprzedni miesiąc" onClick={() => props.onMonth(-1)} disabled={!props.canPreviousMonth || busy}>‹</button><h2>{new Intl.DateTimeFormat("pl-PL",{month:"long",year:"numeric"}).format(props.month)}</h2><button type="button" aria-label="Następny miesiąc" onClick={() => props.onMonth(1)} disabled={busy}>›</button></div>
            <div className="story-week" aria-hidden="true">{["Pn","Wt","Śr","Cz","Pt","So","Nd"].map(label=><span key={label}>{label}</span>)}</div>
            {props.calendarReady ? <div className="story-days">{props.days.map(day => {const key=keyFor(day.date);return <button type="button" key={key} disabled={busy || !day.freeSlots} className={`${key === props.dateKey ? "selected" : ""} ${day.monthOffset ? "outside" : ""}`} aria-pressed={key===props.dateKey} aria-label={`${dateLabel(key)}, ${day.freeSlots ? "dostępny" : "brak terminów"}`} onClick={()=>{if(!navLock.current){props.onDay(key);go(3)}}}><span>{day.day}</span>{day.freeSlots>0 && <i aria-hidden="true" />}</button>})}</div> : <div className="story-calendar-skeleton" role="status" aria-label="Sprawdzamy dostępność">{Array.from({length:35},(_,index)=><span className="skeleton-block" key={index} aria-hidden="true" />)}</div>}
          </div>
          <button type="button" className="story-nearest" disabled={!props.nearest || !props.calendarReady || busy} onClick={()=>{props.onNearest();go(4)}}><CalendarDays aria-hidden="true" /><span><small>Najbliższy wolny termin</small><strong>{props.nearest ? `${dateLabel(keyFor(props.nearest.date))} · ${props.nearest.time}` : "Brak wolnych terminów"}</strong></span><ArrowRight aria-hidden="true" /></button>
          <button type="button" className="story-text-button" onClick={props.onWaitlist}>Nie pasuje termin? Dołącz do listy rezerwowej</button>
        </>}
        {step === 3 && <><p className="story-date-label"><CalendarDays aria-hidden="true" />{dateLabel(props.dateKey)}</p>{props.calendarReady ? <div className="story-times">{props.times.map(time=><button type="button" key={time} disabled={busy} className={props.time===time?"selected":""} aria-pressed={props.time===time} onClick={()=>{if(!navLock.current){props.onTime(time);go(4)}}}>{time}</button>)}</div> : <div className="story-times story-times-skeleton" role="status" aria-label="Wczytujemy godziny">{Array.from({length:6},(_,index)=><span className="skeleton-block" key={index} aria-hidden="true" />)}</div>}{props.calendarReady && !props.times.length && <p role="status">Nie ma już godzin tego dnia. Wróć do kalendarza i wybierz inny termin.</p>}</>}
        {step === 4 && <form className="story-form" onSubmit={event=>{event.preventDefault();if(validDetails)go(5)}}>
          <label htmlFor="story-name">Imię i nazwisko<input id="story-name" value={props.form.fullName} onChange={event=>props.onForm("fullName",event.target.value)} required minLength={3} autoComplete="name" enterKeyHint="next" /></label>
          <label htmlFor="story-phone">Numer telefonu<span className="story-phone"><span aria-hidden="true">+48</span><input id="story-phone" type="tel" inputMode="tel" value={props.form.phone} onChange={event=>props.onForm("phone",event.target.value)} required autoComplete="tel-national" maxLength={11} pattern="[0-9 ]{9,11}" enterKeyHint="done" aria-describedby="story-phone-hint" /></span></label>
          <p id="story-phone-hint">Wpisz 9 cyfr numeru telefonu.</p><button className="salon-cta" type="submit" disabled={!validDetails || busy}>Przejdź do podsumowania<ArrowRight aria-hidden="true" /></button>
        </form>}
        {step === 5 && <>
          <div className="story-ticket"><span className="salon-overline">TWOJA WIZYTA W B&apos;n&apos;B</span><h2>{service?.name || "Wybierz usługę"}</h2>
            <div className="story-ticket-barber"><ProfileAvatar className="story-avatar" name={barber?.name || "Barber"} photoUrl={barber?.photoUrl}/><span><small>Twój barber</small><strong>{barber?.name}</strong></span></div>
            <dl><div><dt>Dzień</dt><dd>{dateLabel(props.dateKey)}</dd></div><div><dt>Godzina</dt><dd>{props.time || "Wybierz godzinę"}</dd></div><div><dt>Czas</dt><dd>{service?.durationMinutes} min</dd></div><div><dt>Klient</dt><dd>{props.form.fullName}</dd></div><div><dt>Telefon</dt><dd>{props.form.phone}</dd></div></dl>
            <div className="story-price"><span>Do zapłaty w salonie</span><strong>{props.price ?? service?.price}</strong></div>
          </div>
          {!selectionValid && <p role="alert" className="story-notice">Termin lub usługa nie są już dostępne. <button type="button" className="story-text-button" onClick={()=>go(service ? 2 : 1)}>Wybierz ponownie</button></p>}
          <button type="button" className="salon-cta story-confirm" onClick={()=>void confirm()} disabled={busy || offline || !props.canConfirm || !selectionValid} aria-busy={busy}>{busy ? "Zapisujemy wizytę…" : props.rescheduling ? "Potwierdź zmianę terminu" : "Potwierdzam rezerwację"}{busy ? <span className="story-spinner" /> : <Check aria-hidden="true" />}</button>
          <button type="button" className="story-text-button" disabled={busy} onClick={()=>go(4)}>Popraw dane</button>
        </>}
      </div>
      {(props.error || localError) && <div className="story-notice" role="alert"><p>{localError || props.error}</p><button type="button" className="story-text-button" disabled={props.refreshing || busy || offline} onClick={()=>void props.onRetry().catch(()=>setLocalError("Nie udało się odświeżyć dostępności. Spróbuj ponownie."))}>{props.refreshing?"Odświeżanie…":"Odśwież dostępność"}</button></div>}
      {step>0 && step<5 && barber && <div className="story-recap"><span>{barber.name}</span>{service && step>1 && <span>{service.name} · {service.price}</span>}</div>}
    </div>
  </section>;
}
