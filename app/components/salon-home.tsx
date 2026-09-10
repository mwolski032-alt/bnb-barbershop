"use client";
import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { ArrowUpRight, AtSign, MapPin, Clock3, Bell, LogOut } from "lucide-react";
import { realtimeDb } from "../lib/firebase";
import SalonDialog from "./salon-dialog";
import ProfileAvatar from "./profile-avatar";
import type { SalonImage } from "./salon-manager";

export type PublicBarber = { id: string; displayName: string; photoUrl: string; bio: string; specialties: string; instagram: string };
type Props = {
  busy: boolean; signedIn: boolean; admin: boolean; error: string;
  onBook: () => void; onPanel: () => void; onVisits: () => void; onInstall: () => void;
  account?: { name: string; photoUrl?: string | null } | null;
  visitsBadge?: number;
  notification?: { label: string; enabled: boolean; status: string; busy: boolean } | null;
  notice?: { kind: "pending" | "success" | "error"; message: string } | null;
  signingOut?: boolean; onNotifications?: () => void; onSignOut?: () => void;
};

export default function SalonHome(props: Props) {
  const [barbers, setBarbers] = useState<PublicBarber[]>([]);
  const [teamError, setTeamError] = useState(false);
  const [teamLoading, setTeamLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [gallery, setGallery] = useState<SalonImage[]>([]);
  const [settings, setSettings] = useState({ address: "", openingHours: "" });
  const [profile, setProfile] = useState<PublicBarber | null>(null);
  const [image, setImage] = useState<SalonImage | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const imageBarber = image?.barberId ? barbers.find(barber => barber.id === image.barberId) ?? null : null;

  useEffect(() => {
    const controller = new AbortController();
    setTeamError(false);
    setTeamLoading(true);
    fetch("/.netlify/functions/public-barbers", { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => setBarbers(Array.isArray(data.barbers) ? data.barbers : []))
      .catch(() => { if (!controller.signal.aborted) setTeamError(true); })
      .finally(() => { if (!controller.signal.aborted) setTeamLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => onValue(ref(realtimeDb, "shopfront"), snapshot => {
    const value = snapshot.val();
    setGallery(Object.values(value?.gallery || {}).filter((item): item is SalonImage => Boolean(item && typeof item === "object" && "imageUrl" in item))
      .sort((a, b) => a.order - b.order));
    setSettings({ address: String(value?.settings?.address || ""), openingHours: String(value?.settings?.openingHours || "") });
  }, () => { /* The static cover and booking remain available offline. */ }), []);

  const book = <button className="salon-cta" type="button" onClick={props.onBook} disabled={props.busy} aria-busy={props.busy}>
    {props.busy ? "Chwileczkę…" : "Umów wizytę"}<ArrowUpRight aria-hidden="true" />
  </button>;
  const galleryShowcase = gallery.length > 0 ? <div className="salon-gallery">
    <div className="salon-gallery-stage">
      <button className="salon-gallery-feature" type="button" onClick={() => setImage(gallery[0])} aria-label={`Powiększ zdjęcie 1: ${gallery[0].alt}`}>
        <img src={gallery[0].imageUrl} alt={gallery[0].alt} loading="lazy" decoding="async" />
      </button>
      <button className="salon-gallery-show-all" type="button" onClick={() => setGalleryOpen(true)}>Pokaż wszystkie zdjęcia</button>
    </div>
    {gallery.length > 1 && <div className="salon-gallery-thumbnails" aria-label="Miniatury galerii">
      {gallery.slice(1, 6).map((photo, index) => <button type="button" key={photo.id} onClick={() => setImage(photo)} aria-label={`Powiększ zdjęcie ${index + 2}: ${photo.alt}`}>
        <img src={photo.imageUrl} alt={photo.alt} loading="lazy" decoding="async" />
      </button>)}
    </div>}
  </div> : null;
  return <main className="salon-home">
    <header className="salon-header">
      <a href="#salon" className="salon-brand" aria-label="B'n'B Barbershop"><img src="/brand/bnb-mark.png" alt="B'n'B" /></a>
      <div className="salon-header-actions">
        <nav aria-label="Menu główne">
          {props.signedIn && <button
            type="button"
            className="salon-visits-button"
            onClick={props.onVisits}
            aria-label="Moje wizyty"
            aria-describedby={props.visitsBadge ? "salon-visits-attention" : undefined}
          >
            Moje wizyty
            {Boolean(props.visitsBadge) && <span
              className="salon-visits-badge"
              id="salon-visits-attention"
              aria-label={`${props.visitsBadge} wymagających uwagi`}
            >
              {props.visitsBadge! > 9 ? "9+" : props.visitsBadge}
            </span>}
          </button>}
          {props.admin && <button type="button" onClick={props.onPanel}>Twój panel <ArrowUpRight aria-hidden="true" /></button>}
          {!props.signedIn && <button type="button" disabled={props.busy} onClick={props.onBook}>Zaloguj się <ArrowUpRight aria-hidden="true" /></button>}
        </nav>
        {props.account && <div className="salon-session" aria-label="Zalogowane konto">
          {props.notification && <button type="button" className={`salon-notification ${props.notification.status}`} aria-label={props.notification.label} title={props.notification.label}
            aria-pressed={props.notification.enabled} aria-busy={props.notification.busy} disabled={props.notification.busy || props.notification.status === "checking"} onClick={props.onNotifications}>
            <Bell aria-hidden="true" /><span aria-hidden="true" />
          </button>}
          <div className="salon-account-pill">
            <ProfileAvatar className="salon-account-avatar" name={props.account.name} photoUrl={props.account.photoUrl} />
            <strong>{props.account.name}</strong>
            <button type="button" onClick={props.onSignOut} disabled={props.signingOut} aria-busy={props.signingOut} aria-label="Wyloguj">
              <span>{props.signingOut ? "Wylogowuję…" : "Wyloguj"}</span><LogOut aria-hidden="true" />
            </button>
          </div>
        </div>}
      </div>
    </header>
    <section className="salon-cover" id="salon" aria-labelledby="salon-title">
      <div className="salon-cover-media">{galleryShowcase ?? <div className="salon-cover-photo"><picture>
        <source type="image/avif" srcSet="/brand/bnb-hero-960.avif 960w, /brand/bnb-hero-1440.avif 1440w" sizes="(max-width: 700px) 100vw, 65vw" />
        <img src="/brand/bnb-hero-1440.webp" width="1440" height="811" alt="B'n'B Barbershop" fetchPriority="high" />
      </picture></div>}</div>
      <div className="salon-cover-copy"><span className="salon-overline">B&apos;n&apos;B · BARBERSHOP</span>
        <h1 id="salon-title">Dobre cięcie.<br /><em>Twój styl.</em></h1>
        {book}<span className="salon-cover-note">Twój barber. Twój termin.</span>
      </div>
    </section>
    {props.error && <p className="salon-feedback error" role="alert">{props.error}</p>}
    {props.notice && <p className={`salon-feedback ${props.notice.kind}`} role={props.notice.kind === "error" ? "alert" : "status"}>{props.notice.message}</p>}
    <section className="salon-section" aria-labelledby="salon-team-title">
      <div className="salon-section-heading"><div><span className="salon-overline">01 / ZESPÓŁ</span><h2 id="salon-team-title">Za fotelem</h2></div><span>Poznaj swojego barbera</span></div>
      {teamLoading ? <div className="salon-team salon-team-skeleton" role="status" aria-label="Wczytujemy zespół">
        {[0, 1].map(item => <div className="salon-person-skeleton" key={item} aria-hidden="true">
          <span className="skeleton-block skeleton-avatar" /><span><i className="skeleton-block short" /><i className="skeleton-block title" /><i className="skeleton-block medium" /></span>
        </div>)}
      </div> : <div className="salon-team">{barbers.map((barber, index) => <button type="button" className="salon-person" key={barber.id} onClick={() => setProfile(barber)}>
        <ProfileAvatar className="salon-person-photo" name={barber.displayName} photoUrl={barber.photoUrl} />
        <span className="salon-person-copy"><small>BARBER / {String(index + 1).padStart(2, "0")}</small><strong>{barber.displayName}</strong><span>Zobacz profil</span></span><ArrowUpRight aria-hidden="true" />
      </button>)}</div>}
      {teamError ? <p className="salon-empty" role="status">Nie udało się wczytać zespołu. <button type="button" onClick={() => setAttempt(value => value + 1)}>Spróbuj ponownie</button></p> : !teamLoading && !barbers.length && <p className="salon-empty" role="status">Profile zespołu pojawią się tutaj.</p>}
    </section>
    {(settings.address || settings.openingHours) && <section className="salon-address" aria-label="Informacje o salonie">
      {settings.address && <p><MapPin aria-hidden="true" /><span>{settings.address}</span></p>}
      {settings.openingHours && <p><Clock3 aria-hidden="true" /><span>{settings.openingHours}</span></p>}
    </section>}
    <footer className="salon-footer"><span>B&apos;n&apos;B Barbershop</span><button type="button" onClick={props.onInstall}>Zainstaluj aplikację <ArrowUpRight aria-hidden="true" /></button></footer>
    {profile && <SalonDialog title={`Profil: ${profile.displayName}`} onClose={() => setProfile(null)}>
      <ProfileAvatar className="salon-profile-photo" name={profile.displayName} photoUrl={profile.photoUrl} />
      <span className="salon-overline">TWÓJ BARBER</span><h2>{profile.displayName}</h2>
      {profile.bio && <p className="salon-bio">{profile.bio}</p>}
      {profile.specialties && <div className="salon-specialties" aria-label="Specjalizacje">{profile.specialties.split(",").filter(Boolean).map((item, index) => <span key={index}>{item.trim()}</span>)}</div>}
      {profile.instagram && <a className="salon-instagram" href={profile.instagram} target="_blank" rel="noopener noreferrer"><AtSign aria-hidden="true" />Instagram <ArrowUpRight aria-hidden="true" /></a>}
      {book}
    </SalonDialog>}
    {galleryOpen && <SalonDialog title="Wszystkie zdjęcia B'n'B" onClose={() => setGalleryOpen(false)} gallery>
      <div className="salon-gallery-all-heading"><span className="salon-overline">GALERIA B&apos;N&apos;B</span><h2>Wszystkie zdjęcia</h2></div>
      <div className="salon-gallery-all">{gallery.map((photo, index) => <button type="button" key={photo.id} onClick={() => { setGalleryOpen(false); setImage(photo); }} aria-label={`Powiększ zdjęcie ${index + 1}: ${photo.alt}`}>
        <img src={photo.imageUrl} alt={photo.alt} loading="lazy" decoding="async" /><span>{String(index + 1).padStart(2, "0")}</span>
      </button>)}</div>
    </SalonDialog>}
    {image && <SalonDialog title={image.alt || "Zdjęcie galerii"} onClose={() => setImage(null)} wide>
      <div className="salon-lightbox-work">
        {imageBarber && <div className="salon-work-credit" aria-label={`Wykonawca: ${imageBarber.displayName}`}>
          <ProfileAvatar className="salon-work-credit-avatar" name={imageBarber.displayName} photoUrl={imageBarber.photoUrl} />
          <span><small>WYKONAŁ</small><strong>{imageBarber.displayName}</strong></span>
        </div>}
        <img className="salon-lightbox-photo" src={image.imageUrl} alt={image.alt} />
      </div>
    </SalonDialog>}
  </main>;
}
