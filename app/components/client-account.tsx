"use client";
import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Bell, Camera, Check, Lock, LogOut, RotateCcw } from "lucide-react";
import { formatPhoneNumber } from "../lib/booking-format";
import { getPhoneDigits } from "../lib/booking-selectors";
import { useCountUp } from "../hooks/use-count-up";
import { prepareAvatar, type ClientProfile } from "../lib/client-profile";
import ProfileAvatar from "./profile-avatar";
import SalonDialog from "./salon-dialog";

export type AccountStats = { visits: number; topBarber: string; next: string };
type BarberChoice = { id: string; displayName: string; photoUrl: string };
type Props = {
  email: string;
  /** Name and picture from the Google profile: shown until the client picks their own. */
  authName: string;
  authPhotoUrl?: string | null;
  profile: ClientProfile;
  stats: AccountStats;
  barbers: BarberChoice[];
  notification?: { label: string; enabled: boolean; busy: boolean; status: string } | null;
  onNotifications?: () => void;
  onSave: (profile: ClientProfile) => Promise<void>;
  onSignOut?: () => void;
  signingOut?: boolean;
  onClose: () => void;
};

function Stat({ label, value, text }: { label: string; value?: number; text?: string }) {
  const counted = useCountUp(value ?? 0, { duration: 1100, delay: 250 });
  return <div className="account-stat"><strong>{value === undefined ? text : counted}</strong><span>{label}</span></div>;
}

/** "Moje konto": name, phone, picture, favourite barber and notifications, with a few small flourishes. */
export default function ClientAccount(props: Props) {
  const { profile } = props;
  const [name, setName] = useState(profile.displayName ?? props.authName);
  const [phone, setPhone] = useState(profile.phone ? formatPhoneNumber(profile.phone) : "");
  const [photo, setPhoto] = useState(profile.photoUrl ?? "");
  const [favorite, setFavorite] = useState(profile.favoriteBarberId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const digits = getPhoneDigits(phone);
  const trimmed = name.trim();
  const nameOk = trimmed.length >= 3 && trimmed.length <= 60;
  const phoneOk = digits.length === 0 || digits.length === 9;
  const dirty = trimmed !== (profile.displayName ?? props.authName) || digits !== (profile.phone ?? "") || photo !== (profile.photoUrl ?? "") || favorite !== (profile.favoriteBarberId ?? "");
  const confetti = useMemo(() => Array.from({ length: 16 }, (_, index) => ({ x: Math.cos(index * 0.39) * (70 + (index % 4) * 22), y: -Math.abs(Math.sin(index * 0.39)) * (80 + (index % 3) * 30) - 20, hue: index % 3 })), []);

  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !card.current) return;
    const box = card.current.getBoundingClientRect();
    card.current.style.setProperty("--ry", `${((event.clientX - box.left) / box.width - 0.5) * 8}deg`);
    card.current.style.setProperty("--rx", `${(0.5 - (event.clientY - box.top) / box.height) * 6}deg`);
  };

  async function save() {
    if (!nameOk || !phoneOk || state === "saving") return;
    setState("saving"); setError("");
    try {
      await props.onSave({ displayName: trimmed === props.authName ? "" : trimmed, phone: digits, photoUrl: photo, favoriteBarberId: favorite });
      setState("saved");
      window.setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("idle"); setError("Nie udało się zapisać zmian. Spróbuj ponownie.");
    }
  }

  return <SalonDialog title="Moje konto" onClose={props.onClose} className="account-dialog">
    <div className="account-card" ref={card} onPointerMove={tilt} onPointerLeave={() => { card.current?.style.setProperty("--rx", "0deg"); card.current?.style.setProperty("--ry", "0deg"); }}>
      <div className="account-hero" aria-hidden="true"><i /><i /><i /></div>
      <div className="account-who">
        <button type="button" className="account-avatar" onClick={() => file.current?.click()} disabled={photoBusy} aria-label="Zmień zdjęcie profilowe">
          <ProfileAvatar key={photo} className="account-avatar-photo" name={trimmed || props.authName} photoUrl={photo || props.authPhotoUrl} />
          <span className="account-avatar-edit">{photoBusy ? "…" : <Camera aria-hidden="true" />}</span>
        </button>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => {
          const picked = event.target.files?.[0]; event.target.value = "";
          if (!picked) return;
          setPhotoBusy(true); setError("");
          prepareAvatar(picked).then(setPhoto).catch(failure => setError(failure instanceof Error ? failure.message : "Nie udało się przygotować zdjęcia.")).finally(() => setPhotoBusy(false));
        }} />
        <span className="salon-overline">MOJE KONTO</span>
        <h2>{trimmed || props.authName}</h2>
        {photo && <button type="button" className="account-link" onClick={() => setPhoto("")}><RotateCcw aria-hidden="true" /> Wróć do zdjęcia z Google</button>}
      </div>

      <div className="account-stats">
        <Stat label="wizyt" value={props.stats.visits} />
        <Stat label="ulubiony barber" text={props.stats.topBarber || "—"} />
        <Stat label="najbliższa wizyta" text={props.stats.next || "—"} />
      </div>

      <form className="account-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label>Imię i nazwisko
          <input value={name} maxLength={60} autoComplete="name" onChange={event => setName(event.target.value)} aria-invalid={!nameOk} />
          {!nameOk && <small>Wpisz co najmniej 3 znaki.</small>}
        </label>
        <label>Numer telefonu
          <input value={phone} inputMode="tel" autoComplete="tel" placeholder="500 600 700" onChange={event => setPhone(formatPhoneNumber(event.target.value))} aria-invalid={!phoneOk} />
          <small>{phoneOk ? "Zapamiętamy go, nie wpiszesz go przy kolejnych rezerwacjach." : "Numer ma 9 cyfr."}</small>
        </label>
        <label className="account-readonly">Adres e-mail
          <span><Lock aria-hidden="true" />{props.email}</span>
          <small>Adresu nie można zmienić, bo jest powiązany z Twoim logowaniem.</small>
        </label>

        {props.barbers.length > 0 && <fieldset className="account-barbers">
          <legend>Ulubiony barber</legend>
          <div>{props.barbers.map(barber => <button type="button" key={barber.id} aria-pressed={favorite === barber.id} onClick={() => setFavorite(favorite === barber.id ? "" : barber.id)}>
            <ProfileAvatar className="account-barber-photo" name={barber.displayName} photoUrl={barber.photoUrl} />{barber.displayName}
          </button>)}</div>
          <small>Rezerwacja od razu zaczyna się od niego.</small>
        </fieldset>}

        {props.notification && <button type="button" className="account-notify" aria-pressed={props.notification.enabled} disabled={props.notification.busy || props.notification.status === "checking"} onClick={props.onNotifications}>
          <Bell aria-hidden="true" /><span><strong>Powiadomienia</strong><small>{props.notification.label}</small></span><i aria-hidden="true" />
        </button>}

        {error && <p className="salon-feedback error" role="alert">{error}</p>}
        <button type="submit" className={`salon-cta account-save ${state}`} disabled={!dirty || !nameOk || !phoneOk || state === "saving"}>
          {state === "saved" ? <><Check aria-hidden="true" /> Zapisano</> : state === "saving" ? "Zapisuję…" : "Zapisz zmiany"}
          {state === "saved" && <span className="account-confetti" aria-hidden="true">{confetti.map((piece, index) => <i key={index} data-hue={piece.hue} style={{ "--x": `${piece.x}px`, "--y": `${piece.y}px` } as CSSProperties} />)}</span>}
        </button>
        {props.onSignOut && <button type="button" className="account-logout" onClick={props.onSignOut} disabled={props.signingOut} aria-busy={props.signingOut}>
          <LogOut aria-hidden="true" /> {props.signingOut ? "Wylogowuję…" : "Wyloguj"}
        </button>}
      </form>
    </div>
  </SalonDialog>;
}
