"use client";
import { useEffect, useRef, useState } from "react";
import { onValue, ref } from "firebase/database";
import { ArrowUpRight, AtSign, MapPin, Clock3, ChevronDown, LogOut, Star, Scissors } from "lucide-react";
import { realtimeDb } from "../lib/firebase";
import {
  emptyReviewSummary,
  fetchPublicReviews,
  reviewAverageLabel,
  reviewCountLabel,
  type Review,
  type ReviewSummary,
} from "../lib/reviews";
import SalonDialog from "./salon-dialog";
import ReviewsDialog from "./reviews-dialog";
import ReviewStars from "./review-stars";
import ReviewPrompt from "./review-prompt";
import { useCountUp } from "../hooks/use-count-up";
import ProfileAvatar from "./profile-avatar";
import GalleryPhoto from "./gallery-photo";
import GalleryLightbox from "./gallery-lightbox";
import GalleryMosaic from "./gallery-mosaic";
import { buildLabel } from "../lib/build-info";
import ClientAccount, { type AccountStats } from "./client-account";
import type { ClientProfile } from "../lib/client-profile";
import { useReveal } from "../hooks/use-reveal";
import { useBackNavigation } from "../hooks/use-back-navigation";
import type { SalonImage } from "./salon-manager";

export type PublicBarber = { id: string; displayName: string; photoUrl: string; bio: string; specialties: string; instagram: string };
type Props = {
  busy: boolean; signedIn: boolean; admin: boolean; error: string;
  /** `onBook(barberId)` starts a booking with that barber already chosen. */
  onBook: (barberId?: string) => void; onLogin?: () => void; onPanel: () => void; onVisits: () => void; onInstall?: () => void;
  account?: { name: string; photoUrl?: string | null } | null;
  visitsBadge?: number;
  /** A settled visit the client has not reviewed yet; shown as a reminder above the gallery. */
  reviewPrompt?: { appointmentId: string; barberId: string; barberName: string } | null;
  onReviewed?: (barberId: string) => void;
  installed?: boolean;
  installing?: boolean;
  repeatVisit?: { serviceName: string; barberName: string } | null;
  notification?: { label: string; enabled: boolean; status: string; busy: boolean } | null;
  notice?: { kind: "pending" | "success" | "error"; message: string } | null;
  signingOut?: boolean; onNotifications?: () => void; onSignOut?: () => void;
  onRepeatVisit?: () => void;
  /** The signed-in client's own account: shown in a dialog opened from the account pill. */
  accountPanel?: { email: string; authName: string; authPhotoUrl?: string | null; profile: ClientProfile; stats: AccountStats; onSave: (profile: ClientProfile) => Promise<void> } | null;
};

// The salon page can be unmounted and mounted again while the session is verified. Keeping
// the last public data here avoids a skeleton flash and a second network round trip.
const shared = {
  barbers: [] as PublicBarber[], teamFetchedAt: 0, gallery: [] as SalonImage[], settings: { address: "", openingHours: "" },
  reviews: [] as Review[], reviewSummary: emptyReviewSummary as ReviewSummary, reviewsFetchedAt: 0,
};
const TEAM_FRESH_MS = 60_000;

/**
 * The counting numbers live in their own component: they change on every animation frame, and this keeps
 * those frames from re-rendering the whole salon page (gallery, team, dialogs) around them.
 */
function ReviewsEntryLine({ summary }: { summary: ReviewSummary }) {
  const averageShown = useCountUp(summary.average, { decimals: 1, duration: 1200, delay: 200 });
  const countShown = useCountUp(summary.count, { duration: 1200, delay: 200 });
  return <span className="salon-reviews-entry-line" aria-hidden="true">
    <ReviewStars rating={summary.average} size="sm" animated />
    <small>{reviewAverageLabel(averageShown)} / 5 · {reviewCountLabel(Math.round(countShown))}</small>
  </span>;
}

export default function SalonHome(props: Props) {
  const [barbers, setBarbers] = useState<PublicBarber[]>(() => shared.barbers);
  const [teamError, setTeamError] = useState(false);
  const [teamLoading, setTeamLoading] = useState(() => shared.teamFetchedAt === 0);
  const [attempt, setAttempt] = useState(0);
  const [gallery, setGallery] = useState<SalonImage[]>(() => shared.gallery);
  const [settings, setSettings] = useState(() => shared.settings);
  const root = useRef<HTMLElement>(null);
  useReveal(root, `${teamLoading}-${barbers.length}-${settings.address}-${settings.openingHours}`);
  const [profile, setProfile] = useState<PublicBarber | null>(null);
  // Booking from a barber's profile closes the profile dialog first; the booking starts once it is gone.
  const bookAfterClose = useRef<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // A small bubble points at the account pill until the client has opened it once (remembered on this device).
  const [hintSeen, setHintSeen] = useState(true);
  useEffect(() => { try { setHintSeen(localStorage.getItem("bnb-account-hint") === "1"); } catch { setHintSeen(false); } }, []);
  const dismissHint = () => { setHintSeen(true); try { localStorage.setItem("bnb-account-hint", "1"); } catch { /* The bubble just shows again next time. */ } };
  const showHint = Boolean(props.accountPanel) && !hintSeen && !accountOpen;
  const [reviews, setReviews] = useState<Review[]>(() => shared.reviews);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary>(() => shared.reviewSummary);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  // The floating booking button appears only once the main one has scrolled out of view.
  const coverCta = useRef<HTMLDivElement>(null);
  const [dockVisible, setDockVisible] = useState(false);
  useEffect(() => {
    const target = coverCta.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setDockVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0), { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  // Cards follow the pointer with a soft spotlight; position is written straight to CSS variables.
  const trackPointer = (event: React.PointerEvent<HTMLElement>) => {
    const card = event.currentTarget, box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - box.left}px`);
    card.style.setProperty("--my", `${event.clientY - box.top}px`);
  };

  useEffect(() => {
    if (attempt === 0 && Date.now() - shared.teamFetchedAt < TEAM_FRESH_MS) { setTeamLoading(false); return; }
    const controller = new AbortController();
    setTeamError(false);
    setTeamLoading(shared.teamFetchedAt === 0);
    fetch("/.netlify/functions/public-barbers", { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => {
        const list: PublicBarber[] = Array.isArray(data.barbers) ? data.barbers : [];
        shared.barbers = list; shared.teamFetchedAt = Date.now();
        setBarbers(list);
      })
      .catch(() => { if (!controller.signal.aborted) setTeamError(true); })
      .finally(() => { if (!controller.signal.aborted) setTeamLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  // Reviews are secondary: a failed request simply leaves the "Opinie" card in its empty state.
  useEffect(() => {
    if (Date.now() - shared.reviewsFetchedAt < TEAM_FRESH_MS) return;
    const controller = new AbortController();
    fetchPublicReviews(controller.signal)
      .then(data => {
        shared.reviews = data.reviews; shared.reviewSummary = data.summary; shared.reviewsFetchedAt = Date.now();
        setReviews(data.reviews); setReviewSummary(data.summary);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => onValue(ref(realtimeDb, "shopfront"), snapshot => {
    const value = snapshot.val();
    const photos = Object.values(value?.gallery || {}).filter((item): item is SalonImage => Boolean(item && typeof item === "object" && "imageUrl" in item))
      .sort((a, b) => a.order - b.order);
    const info = { address: String(value?.settings?.address || ""), openingHours: String(value?.settings?.openingHours || "") };
    shared.gallery = photos; shared.settings = info;
    setGallery(photos);
    setSettings(info);
  }, () => { /* The static cover and booking remain available offline. */ }), []);

  // The phone's Back button closes the topmost dialog of this page (photo viewer, all photos, barber profile).
  useBackNavigation([
    { active: lightbox !== null, close: () => setLightbox(null) },
    { active: accountOpen, close: () => setAccountOpen(false) },
    { active: galleryOpen, close: () => setGalleryOpen(false) },
    { active: reviewsOpen, close: () => setReviewsOpen(false) },
    { active: reviewFormOpen, close: () => setReviewFormOpen(false) },
    { active: profile !== null, close: () => setProfile(null) },
  ], false, { group: "salon", priority: 10 });

  // A photo credits a barber only when the owner chose one; otherwise nothing is shown, as before.
  const photoBarber = (photo: SalonImage) => barbers.find(barber => barber.id === photo.barberId)?.displayName ?? "";
  const photoAuthor = (photo: SalonImage) => { const barber = barbers.find(item => item.id === photo.barberId); return barber ? { name: barber.displayName, photoUrl: barber.photoUrl } : null; };
  // "Umów wizytę" starts with the client's favourite barber when they chose one in "Moje konto".
  const favoriteId = props.signedIn ? props.accountPanel?.profile.favoriteBarberId : undefined;
  const bookDefault = () => props.onBook(favoriteId && barbers.some(barber => barber.id === favoriteId) ? favoriteId : undefined);
  const book = <button className="salon-cta" type="button" onClick={bookDefault} disabled={props.busy} aria-busy={props.busy}>
    {props.busy ? "Chwileczkę…" : "Umów wizytę"}<ArrowUpRight aria-hidden="true" />
  </button>;
  const galleryShowcase = gallery.length > 0 ? <div className="salon-gallery">
    <div className="salon-gallery-stage">
      <button className="salon-gallery-feature" type="button" onClick={() => setLightbox(0)} aria-label={`Powiększ zdjęcie 1: ${gallery[0].alt}`}>
        <GalleryPhoto photo={gallery[0]} sizes="(max-width: 1160px) 100vw, 1112px" priority />
      </button>
      <button className="salon-gallery-show-all" type="button" onClick={() => setGalleryOpen(true)}>Pokaż wszystkie zdjęcia</button>
    </div>
    {gallery.length > 1 && <div className="salon-gallery-thumbnails" aria-label="Miniatury galerii">
      {gallery.slice(1, 6).map((photo, index) => <button type="button" key={photo.id} onClick={() => setLightbox(index + 1)} aria-label={`Powiększ zdjęcie ${index + 2}: ${photo.alt}`}>
        <GalleryPhoto photo={photo} sizes="(max-width: 700px) 20vw, 210px" />
      </button>)}
    </div>}
  </div> : null;
  return <main className="salon-home" ref={root}>
    <span className="salon-aurora" aria-hidden="true" />
    <header className="salon-header">
      <button type="button" className="salon-brand" aria-label="B'n'B Barbershop: wróć na górę strony" onClick={() => {
        // Scroll to the top. The old #salon link changed the URL hash, which fired popstate and made the page jump.
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      }}><img src="/brand/bnb-mark.png" alt="B'n'B" /></button>
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
          {!props.signedIn && <button type="button" disabled={props.busy} onClick={props.onLogin ?? (() => props.onBook())}>Zaloguj się <ArrowUpRight aria-hidden="true" /></button>}
        </nav>
        {props.account && <div className="salon-session" aria-label="Zalogowane konto">
          <div className="salon-account-pill">
            {props.accountPanel
              ? <button type="button" className="salon-account-open" onClick={() => { dismissHint(); setAccountOpen(true); }} aria-label="Moje konto: zdjęcie, imię, telefon i wylogowanie">
                <span className="salon-account-avatar-wrap" data-hint={showHint || undefined}>
                  <ProfileAvatar className="salon-account-avatar" name={props.account.name} photoUrl={props.account.photoUrl} />
                </span>
                <strong><span className="salon-account-full">{props.account.name}</span><span className="salon-account-first">{props.account.name.trim().split(/\s+/)[0]}</span></strong>
                <span className="salon-account-cta">Konto <ChevronDown aria-hidden="true" /></span>
              </button>
              : <>
                <ProfileAvatar className="salon-account-avatar" name={props.account.name} photoUrl={props.account.photoUrl} />
                <strong>{props.account.name}</strong>
                <button type="button" onClick={props.onSignOut} disabled={props.signingOut} aria-busy={props.signingOut} aria-label="Wyloguj">
                  <span>{props.signingOut ? "Wylogowuję…" : "Wyloguj"}</span><LogOut aria-hidden="true" />
                </button>
              </>}
          </div>
          {showHint && <div className="salon-account-hint" role="note">
            <p>Tu zmienisz zdjęcie, imię i telefon.</p>
            <button type="button" onClick={dismissHint}>Rozumiem</button>
          </div>}
        </div>}
      </div>
    </header>
    {props.reviewPrompt && <button type="button" className="salon-review-nudge" onClick={() => setReviewFormOpen(true)}>
      <span className="salon-review-nudge-stars" aria-hidden="true">{[0, 1, 2, 3, 4].map(index => <Star key={index} style={{ "--i": index } as React.CSSProperties} />)}</span>
      <span className="salon-review-nudge-copy">
        <strong>{props.reviewPrompt.barberName ? `Zostaw opinię dla ${props.reviewPrompt.barberName}` : "Zostaw opinię o wizycie"}</strong>
        <small>Zajmie to kilka sekund</small>
      </span>
      <ArrowUpRight aria-hidden="true" />
    </button>}
    {props.repeatVisit && <section className="salon-repeat-card" aria-labelledby="salon-repeat-title">
      <span className="salon-repeat-icon" aria-hidden="true"><Scissors /></span>
      <div>
        <span className="salon-overline">TWOJA OSTATNIA WIZYTA</span>
        <h2 id="salon-repeat-title">Czas na kolejne cięcie?</h2>
        <p>Ostatnio: {props.repeatVisit.serviceName} · {props.repeatVisit.barberName}.</p>
      </div>
      <button type="button" onClick={props.onRepeatVisit}>Umów ponownie <ArrowUpRight aria-hidden="true" /></button>
    </section>}
    <section className="salon-cover" id="salon" aria-labelledby="salon-title">
      <div className="salon-cover-media">{galleryShowcase ?? <div className="salon-cover-photo"><picture>
        <source type="image/avif" srcSet="/brand/bnb-hero-960.avif 960w, /brand/bnb-hero-1440.avif 1440w" sizes="(max-width: 700px) 100vw, 65vw" />
        <img src="/brand/bnb-hero-1440.webp" width="1440" height="811" alt="B'n'B Barbershop" fetchPriority="high" />
      </picture></div>}</div>
      <div className="salon-cover-copy"><span className="salon-overline">B&apos;n&apos;B · BARBERSHOP</span>
        <h1 id="salon-title">Dobre cięcie.<br /><em>Twój styl.</em></h1>
        <div className="salon-cta-wrap" ref={coverCta}>{book}</div><span className="salon-cover-note">Twój barber. Twój termin.</span>      </div>
    </section>    {props.error && <p className="salon-feedback error" role="alert">{props.error}</p>}
    {props.notice && <p className={`salon-feedback ${props.notice.kind}`} role={props.notice.kind === "error" ? "alert" : "status"}>{props.notice.message}</p>}
    <section className="salon-section" aria-labelledby="salon-team-title">
      <div className="salon-section-heading" data-reveal><div><span className="salon-overline">01 / ZESPÓŁ</span><h2 id="salon-team-title">Za fotelem</h2></div><span>Poznaj swojego barbera</span></div>
      {teamLoading ? <div className="salon-team salon-team-skeleton" role="status" aria-label="Wczytujemy zespół">
        {[0, 1].map(item => <div className="salon-person-skeleton" key={item} aria-hidden="true">
          <span className="skeleton-block skeleton-avatar" /><span><i className="skeleton-block short" /><i className="skeleton-block title" /><i className="skeleton-block medium" /></span>
        </div>)}
      </div> : <div className="salon-team">{barbers.map((barber, index) => <button type="button" className="salon-person" key={barber.id} data-reveal style={{ "--reveal-index": index + 1 } as React.CSSProperties} onPointerMove={trackPointer} onClick={() => setProfile(barber)}>
        <ProfileAvatar className="salon-person-photo" name={barber.displayName} photoUrl={barber.photoUrl} />
        <span className="salon-person-copy"><small>BARBER / {String(index + 1).padStart(2, "0")}</small><strong>{barber.displayName}</strong><span>Zobacz profil</span></span><ArrowUpRight aria-hidden="true" />
      </button>)}</div>}
      {teamError ? <p className="salon-empty" role="status">Nie udało się wczytać zespołu. <button type="button" onClick={() => setAttempt(value => value + 1)}>Spróbuj ponownie</button></p> : !teamLoading && !barbers.length && <p className="salon-empty" role="status">Profile zespołu pojawią się tutaj.</p>}
    </section>
    <button type="button" className="salon-reviews-entry" data-reveal onClick={() => setReviewsOpen(true)}
      aria-label={reviewSummary.count ? `Opinie klientów: średnia ${reviewAverageLabel(reviewSummary.average)} na 5, ${reviewCountLabel(reviewSummary.count)}` : "Opinie klientów"}>
      <span className="salon-reviews-entry-icon" aria-hidden="true"><Star /><i /><i /><i /></span>
      <span className="salon-reviews-entry-copy">
        <strong>Opinie</strong>
        {reviewSummary.count
          ? <ReviewsEntryLine summary={reviewSummary} />
          : <small>Co mówią nasi klienci</small>}
      </span>
      <ArrowUpRight aria-hidden="true" />
    </button>
    {(settings.address || settings.openingHours) && <section className="salon-address" aria-label="Informacje o salonie" data-reveal>
      {settings.address && <p><MapPin aria-hidden="true" /><span>{settings.address}</span></p>}
      {settings.openingHours && <p><Clock3 aria-hidden="true" /><span>{settings.openingHours}</span></p>}
    </section>}
    <footer className="salon-footer" data-reveal><span>B&apos;n&apos;B Barbershop</span>{props.onInstall && !props.installed ? <button type="button" onClick={props.onInstall} disabled={props.installing} aria-busy={props.installing}>{props.installing ? "Otwieram instalację…" : "Zainstaluj aplikację"} <ArrowUpRight aria-hidden="true" /></button> : null}</footer>
    {buildLabel() && <p className="salon-build" aria-label="Wersja aplikacji">{buildLabel()}</p>}
    <div className={`salon-dock ${dockVisible ? "is-visible" : ""}`} aria-hidden={!dockVisible}>
      <button type="button" tabIndex={dockVisible ? 0 : -1} onClick={bookDefault} disabled={props.busy}>Umów wizytę<ArrowUpRight aria-hidden="true" /></button>
    </div>
    {profile && <SalonDialog title={`Profil: ${profile.displayName}`} onClose={() => {
      const barberId = bookAfterClose.current;
      bookAfterClose.current = null;
      setProfile(null);
      if (barberId) props.onBook(barberId);
    }}>{(close) => <>
      <ProfileAvatar className="salon-profile-photo" name={profile.displayName} photoUrl={profile.photoUrl} />
      <span className="salon-overline">TWÓJ BARBER</span><h2>{profile.displayName}</h2>
      {profile.bio && <p className="salon-bio">{profile.bio}</p>}
      {profile.specialties && <div className="salon-specialties" aria-label="Specjalizacje">{profile.specialties.split(",").filter(Boolean).map((item, index) => <span key={index}>{item.trim()}</span>)}</div>}
      {profile.instagram && <a className="salon-instagram" href={profile.instagram} target="_blank" rel="noopener noreferrer"><AtSign aria-hidden="true" />Instagram <ArrowUpRight aria-hidden="true" /></a>}
      <button className="salon-cta" type="button" disabled={props.busy} aria-busy={props.busy} onClick={() => { bookAfterClose.current = profile.id; close(); }}>
        {props.busy ? "Chwileczkę…" : "Umów wizytę"}<ArrowUpRight aria-hidden="true" />
      </button>
    </>}</SalonDialog>}
    {reviewFormOpen && props.reviewPrompt && <SalonDialog title="Zostaw opinię" onClose={() => setReviewFormOpen(false)}>{() =>
      <ReviewPrompt key={props.reviewPrompt!.appointmentId} appointmentId={props.reviewPrompt!.appointmentId} barberName={props.reviewPrompt!.barberName}
        onSubmitted={() => { const barberId = props.reviewPrompt!.barberId; window.setTimeout(() => { setReviewFormOpen(false); props.onReviewed?.(barberId); fetchPublicReviews().then(data => { shared.reviews = data.reviews; shared.reviewSummary = data.summary; shared.reviewsFetchedAt = Date.now(); setReviews(data.reviews); setReviewSummary(data.summary); }).catch(() => undefined); }, 2600); }} />
    }</SalonDialog>}
    {accountOpen && props.accountPanel && <ClientAccount {...props.accountPanel} onSignOut={props.onSignOut} signingOut={props.signingOut} barbers={barbers} notification={props.notification} onNotifications={props.onNotifications} onClose={() => setAccountOpen(false)} />}
    {reviewsOpen && <ReviewsDialog reviews={reviews} summary={reviewSummary} barbers={barbers} onClose={() => setReviewsOpen(false)} />}
    {galleryOpen && <SalonDialog title="Wszystkie zdjęcia B'n'B" onClose={() => setGalleryOpen(false)} gallery>
      <div className="salon-gallery-all-heading"><span className="salon-overline">GALERIA B&apos;N&apos;B</span><h2>Wszystkie zdjęcia</h2></div>
      <GalleryMosaic photos={gallery} barberName={photoBarber} onOpen={index => { setGalleryOpen(false); setLightbox(index); }} />
    </SalonDialog>}
    {lightbox !== null && gallery.length > 0 && <GalleryLightbox photos={gallery} index={Math.min(lightbox, gallery.length - 1)} onIndex={setLightbox} onClose={() => setLightbox(null)} author={photoAuthor} />}
  </main>;
}
