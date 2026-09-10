"use client";
import { useEffect, useRef, useState } from "react";
import { onValue, ref, runTransaction, set } from "firebase/database";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { realtimeDb } from "../lib/firebase";

export type SalonImage = { id: string; imageUrl: string; alt: string; order: number; barberId?: string };
type GalleryBarber = { id: string; displayName: string };

async function preparePhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Wybierz JPG, PNG lub WebP do 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
    canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Nie udało się przygotować zdjęcia.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.45]) {
      const result = canvas.toDataURL("image/webp", quality);
      if (result.length <= 350000) return result;
    }
    throw new Error("Zdjęcie jest zbyt duże po kompresji. Wybierz mniejszy plik.");
  } finally { URL.revokeObjectURL(url); }
}

export default function SalonManager() {
  const [gallery, setGallery] = useState<SalonImage[]>([]);
  const [barbers, setBarbers] = useState<GalleryBarber[]>([]);
  const [barbersLoading, setBarbersLoading] = useState(true);
  const [settings, setSettings] = useState({ address: "", openingHours: "" });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [feedback, setFeedback] = useState("");
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
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => setBarbers(Array.isArray(data.barbers) ? data.barbers : []))
      .catch(() => { /* Przypisania pozostają zachowane, nawet gdy lista zespołu jest chwilowo niedostępna. */ })
      .finally(() => { if (!controller.signal.aborted) setBarbersLoading(false); });
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
    if (optimistic.length > 6) throw new Error("Galeria mieści 6 zdjęć. Usuń jedno przed dodaniem kolejnego.");
    setGallery(optimistic);
    try {
      const result = await runTransaction(ref(realtimeDb, "shopfront/gallery"), current => {
        const images = (Object.values(current || {}) as SalonImage[]).sort((a, b) => a.order - b.order).map(item => ({ ...item }));
        const next = transform(images);
        if (next.length > 6) return;
        return Object.fromEntries(next.map((item, order) => [String(order), { ...item, order }]));
      }, { applyLocally: false });
      if (!result.committed) throw new Error("Galeria mieści 6 zdjęć. Usuń jedno przed dodaniem kolejnego.");
    } catch (error) {
      setGallery(previous);
      throw error;
    }
  }
  return <section className="salon-manager" aria-label="Zarządzanie stroną salonu">
    <div className="salon-section-heading"><div><span className="salon-overline">PANEL ADMINISTRATORA</span><h2>Strona salonu</h2></div></div>
    <p>Galeria jest widoczna dla wszystkich. Pierwsze zdjęcie jest także okładką strony. Zarządza nią wyłącznie administrator.</p>
    <div className="salon-manager-grid" aria-busy={!loaded}>{!loaded ? [0, 1, 2].map(item => <article className="salon-manager-skeleton skeleton-block" key={item} aria-hidden="true" />) : gallery.map((photo, index) => <article key={photo.id}>
      <img src={photo.imageUrl} alt={photo.alt} />
      <span>Zdjęcie {index + 1}</span>
      <label className="salon-photo-barber">
        <span>Wykonawca</span>
        <select value={photo.barberId || ""} disabled={busy || barbersLoading} onChange={event => {
          const barberId = event.target.value;
          void perform(() => changeGallery(images => images.map(item => {
            if (item.id !== photo.id) return item;
            if (barberId) return { ...item, barberId };
            const withoutBarber = { ...item };
            delete withoutBarber.barberId;
            return withoutBarber;
          })));
        }} aria-label={`Wykonawca zdjęcia ${index + 1}`}>
          <option value="">Bez przypisania</option>
          {photo.barberId && !barbers.some(barber => barber.id === photo.barberId) && <option value={photo.barberId}>Przypisany barber (niedostępny)</option>}
          {barbers.map(barber => <option key={barber.id} value={barber.id}>{barber.displayName}</option>)}
        </select>
      </label>
      <div>
        {([-1, 1] as const).map(direction => <button type="button" key={direction} aria-label={direction < 0 ? "Przesuń zdjęcie wcześniej" : "Przesuń zdjęcie dalej"} disabled={busy || index + direction < 0 || index + direction >= gallery.length} onClick={() => void perform(() => changeGallery(images => {
          const position = images.findIndex(item => item.id === photo.id); const destination = position + direction;
          if (position >= 0 && destination >= 0 && destination < images.length) [images[position], images[destination]] = [images[destination], images[position]];
          return images;
        }))}>{direction < 0 ? <ArrowUp /> : <ArrowDown />}</button>)}
        <button type="button" aria-label="Usuń zdjęcie" disabled={busy} onClick={() => {
          if (window.confirm("Usunąć zdjęcie z galerii?")) void perform(() => changeGallery(images => images.filter(item => item.id !== photo.id)));
        }}><Trash2 /></button>
      </div>
    </article>)}</div>
    <label className="salon-upload"><Plus aria-hidden="true" />{busy ? "Zapisywanie…" : `Dodaj zdjęcie (${gallery.length}/6)`}
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || gallery.length >= 6} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void perform(async () => {
          const imageUrl = await preparePhoto(file);
          const photo = { id: crypto.randomUUID(), imageUrl, alt: "Galeria B'n'B Barbershop", order: 0 };
          await changeGallery(images => [...images, photo]);
        });
      }} />
    </label>
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
