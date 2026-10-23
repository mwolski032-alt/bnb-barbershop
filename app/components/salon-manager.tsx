"use client";
import { useEffect, useRef, useState } from "react";
import { onValue, ref, runTransaction, set } from "firebase/database";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { realtimeDb } from "../lib/firebase";
import { deleteGalleryPhotoFiles, migrateLegacyPhoto, uploadGalleryPhoto } from "../lib/gallery-photos";
import { GALLERY_MAX_PHOTOS, isGalleryId } from "../../shared/gallery-images.mjs";
import GalleryPhoto from "./gallery-photo";
import { confirmAction } from "../lib/confirm-action";

export type SalonImage = { id: string; imageUrl: string; alt: string; order: number; storage?: boolean; width?: number; height?: number; blur?: string; barberId?: string };
type TeamBarber = { id: string; displayName: string };
const FULL_MESSAGE = `Galeria mieści ${GALLERY_MAX_PHOTOS} zdjęć. Usuń jedno przed dodaniem kolejnego.`;

export default function SalonManager() {
  const [gallery, setGallery] = useState<SalonImage[]>([]);
  const [settings, setSettings] = useState({ address: "", openingHours: "" });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [feedback, setFeedback] = useState("");
  // The barber who did the haircut is optional: a photo without one looks exactly as before.
  const [barbers, setBarbers] = useState<TeamBarber[]>([]);
  const [uploadBarberId, setUploadBarberId] = useState("");
  const locked = useRef(false);
  const dirty = useRef(false);
  useEffect(() => onValue(ref(realtimeDb, "shopfront"), snapshot => {
    const value = snapshot.val();
    setLoaded(true);
    setGallery((Object.values(value?.gallery || {}) as SalonImage[]).sort((a, b) => a.order - b.order));
    if (!dirty.current) setSettings({ address: String(value?.settings?.address || ""), openingHours: String(value?.settings?.openingHours || "") });
  }, () => setFeedback("Nie udało się wczytać galerii. Sprawdź połączenie i uprawnienia.")), []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/.netlify/functions/public-barbers", { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error()))
      .then(data => setBarbers(Array.isArray(data.barbers) ? data.barbers.map((barber: TeamBarber) => ({ id: barber.id, displayName: barber.displayName })) : []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function perform(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setFeedback("Zapisuję zmiany…");
    try { await operation(); setFeedback("Zmiany zapisane."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Nie udało się zapisać zmian. Spróbuj ponownie."); }
    finally { locked.current = false; setBusy(false); }
  }
  async function changeGallery(transform: (images: SalonImage[]) => SalonImage[]) {
    const previous = gallery.map(item => ({ ...item }));
    const optimistic = transform(previous.map(item => ({ ...item }))).map((item, order) => ({ ...item, order }));
    if (optimistic.length > GALLERY_MAX_PHOTOS) throw new Error(FULL_MESSAGE);
    setGallery(optimistic);
    try {
      const result = await runTransaction(ref(realtimeDb, "shopfront/gallery"), current => {
        const images = (Object.values(current || {}) as SalonImage[]).sort((a, b) => a.order - b.order).map(item => ({ ...item }));
        const next = transform(images);
        if (next.length > GALLERY_MAX_PHOTOS) return;
        return Object.fromEntries(next.map((item, order) => [String(order), { ...item, order }]));
      }, { applyLocally: false });
      if (!result.committed) throw new Error(FULL_MESSAGE);
    } catch (error) {
      setGallery(previous);
      throw error;
    }
  }
  const legacyPhotos = gallery.filter(photo => !photo.storage && isGalleryId(photo.id));
  async function migrateAll() {
    for (const photo of legacyPhotos) {
      const stored = await migrateLegacyPhoto(photo.id, photo.imageUrl);
      await changeGallery(images => images.map(item => item.id === photo.id ? { ...item, ...stored } : item));
    }
  }
  return <section className="salon-manager" aria-label="Zarządzanie stroną salonu">
    <div className="salon-section-heading"><div><span className="salon-overline">PANEL ADMINISTRATORA</span><h2>Strona salonu</h2></div></div>
    <p>Galeria jest widoczna dla wszystkich. Pierwsze zdjęcie jest także okładką strony. Zarządza nią wyłącznie administrator.</p>
    <div className="salon-manager-grid" aria-busy={!loaded}>{!loaded ? [0, 1, 2].map(item => <article className="salon-manager-skeleton skeleton-block" key={item} aria-hidden="true" />) : gallery.map((photo, index) => <article key={photo.id}>
      <GalleryPhoto photo={photo} sizes="(max-width: 700px) 50vw, 340px" />
      <span>Zdjęcie {index + 1}</span>
      <label className="salon-photo-barber">Barber
        <select value={photo.barberId ?? ""} disabled={busy} onChange={event => { const barberId = event.target.value; void perform(() => changeGallery(images => images.map(item => {
          if (item.id !== photo.id) return item;
          const rest = { ...item };
          delete rest.barberId;
          return barberId ? { ...rest, barberId } : rest;
        }))); }}>
          <option value="">Bez przypisania</option>
          {barbers.map(barber => <option key={barber.id} value={barber.id}>{barber.displayName}</option>)}
          {photo.barberId && !barbers.some(barber => barber.id === photo.barberId) && <option value={photo.barberId}>{photo.barberId}</option>}
        </select>
      </label><div>
        {([-1, 1] as const).map(direction => <button type="button" key={direction} aria-label={direction < 0 ? "Przesuń zdjęcie wcześniej" : "Przesuń zdjęcie dalej"} disabled={busy || index + direction < 0 || index + direction >= gallery.length} onClick={() => void perform(() => changeGallery(images => {
          const position = images.findIndex(item => item.id === photo.id); const destination = position + direction;
          if (position >= 0 && destination >= 0 && destination < images.length) [images[position], images[destination]] = [images[destination], images[position]];
          return images;
        }))}>{direction < 0 ? <ArrowUp /> : <ArrowDown />}</button>)}
        <button type="button" aria-label="Usuń zdjęcie" disabled={busy} onClick={async () => {
          if (await confirmAction({ title: "Usunąć zdjęcie z galerii?", message: "Zdjęcie zniknie ze strony salonu.", confirmLabel: "Usuń zdjęcie", tone: "danger" })) void perform(async () => {
            await changeGallery(images => images.filter(item => item.id !== photo.id));
            if (photo.storage) await deleteGalleryPhotoFiles(photo.id);
          });
        }}><Trash2 /></button>
      </div>
    </article>)}</div>
    <label className="salon-photo-barber salon-upload-barber">Barber, który wykonał strzyżenie (opcjonalnie)
      <select value={uploadBarberId} disabled={busy} onChange={event => setUploadBarberId(event.target.value)}>
        <option value="">Bez przypisania</option>
        {barbers.map(barber => <option key={barber.id} value={barber.id}>{barber.displayName}</option>)}
      </select>
    </label>
    <label className="salon-upload"><Plus aria-hidden="true" />{busy ? "Zapisywanie…" : `Dodaj zdjęcie (${gallery.length}/${GALLERY_MAX_PHOTOS})`}
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || gallery.length >= GALLERY_MAX_PHOTOS} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void perform(async () => {
          const id = crypto.randomUUID();
          const stored = await uploadGalleryPhoto(id, file);
          const photo: SalonImage = { id, alt: "Galeria B'n'B Barbershop", order: 0, ...stored, ...(uploadBarberId ? { barberId: uploadBarberId } : {}) };
          try { await changeGallery(images => [...images, photo]); }
          catch (error) { await deleteGalleryPhotoFiles(id); throw error; }
        });
      }} />
    </label>
    {legacyPhotos.length > 0 && <div className="salon-migrate">
      <p>{legacyPhotos.length} {legacyPhotos.length === 1 ? "zdjęcie jest zapisane" : "zdjęć jest zapisanych"} w starym formacie. Zoptymalizowanie przyspieszy ładowanie strony.</p>
      <button type="button" className="salon-cta" disabled={busy} onClick={() => void perform(migrateAll)}>Zoptymalizuj zdjęcia</button>
    </div>}
    <form onSubmit={event => { event.preventDefault(); void perform(async () => {
      await set(ref(realtimeDb, "shopfront/settings"), { address: settings.address.trim(), openingHours: settings.openingHours.trim() }); dirty.current = false;
    }); }}>
      <h3>Informacje o salonie</h3><p>Puste pola nie będą wyświetlane na stronie.</p>
      <label>Adres<input disabled={!loaded || busy} maxLength={160} value={settings.address} onChange={event => { dirty.current = true; setSettings(current => ({ ...current, address: event.target.value })); }} /></label>
      <label>Godziny otwarcia<textarea disabled={!loaded || busy} maxLength={300} value={settings.openingHours} onChange={event => { dirty.current = true; setSettings(current => ({ ...current, openingHours: event.target.value })); }} /></label>
      <button className="salon-cta" disabled={busy || !loaded} type="submit">{busy ? "Zapisywanie…" : !loaded ? "Wczytywanie…" : "Zapisz informacje"}</button>
    </form>
    {feedback && <p role="status" className="salon-feedback">{feedback}</p>}
  </section>;
}
