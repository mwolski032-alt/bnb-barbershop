"use client";
import { useEffect, useRef, useState } from "react";
import { onValue, ref, remove, runTransaction } from "firebase/database";
import { Plus, Trash2 } from "lucide-react";
import { realtimeDb } from "../lib/firebase";
import { deleteGalleryPhotoFiles, uploadGalleryPhoto } from "../lib/gallery-photos";
import { GALLERY_MAX_PHOTOS } from "../../shared/gallery-images.mjs";
import { confirmAction } from "../lib/confirm-action";
import GalleryPhoto from "./gallery-photo";
import type { SalonImage } from "./salon-manager";

type Entry = { slot: string; photo: SalonImage };
const FULL_MESSAGE = `Galeria jest pełna (${GALLERY_MAX_PHOTOS} zdjęć). Poproś właściciela o usunięcie starszych zdjęć.`;

/** The barber's own gallery photos: they can add new ones and delete theirs, nothing else. */
export default function BarberGallery({ barberId }: { barberId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const locked = useRef(false);
  useEffect(() => onValue(ref(realtimeDb, "shopfront/gallery"), snapshot => {
    const value = (snapshot.val() ?? {}) as Record<string, SalonImage>;
    setEntries(Object.entries(value).map(([slot, photo]) => ({ slot, photo })).sort((a, b) => a.photo.order - b.photo.order));
    setLoaded(true);
  }, () => { setLoaded(true); setFeedback("Nie udało się wczytać galerii. Sprawdź połączenie."); }), []);

  const mine = entries.filter(entry => entry.photo.barberId === barberId);
  const full = entries.length >= GALLERY_MAX_PHOTOS;

  async function perform(operation: () => Promise<void>, done: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setFeedback("Zapisuję…");
    try { await operation(); setFeedback(done); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Nie udało się zapisać zmian. Spróbuj ponownie."); }
    finally { locked.current = false; setBusy(false); }
  }

  async function addPhoto(file: File) {
    if (full) throw new Error(FULL_MESSAGE);
    const id = crypto.randomUUID();
    const stored = await uploadGalleryPhoto(id, file);
    const nextOrder = Math.min(GALLERY_MAX_PHOTOS - 1, entries.reduce((highest, entry) => Math.max(highest, entry.photo.order), -1) + 1);
    const photo: SalonImage = { id, alt: "Galeria B'n'B Barbershop", order: nextOrder, ...stored, barberId };
    try {
      // Claim the first free slot. A transaction that finds the slot taken gives up, so two barbers can never overwrite each other.
      const taken = new Set(entries.map(entry => entry.slot));
      for (let slot = 0; slot < GALLERY_MAX_PHOTOS; slot += 1) {
        if (taken.has(String(slot))) continue;
        const result = await runTransaction(ref(realtimeDb, `shopfront/gallery/${slot}`), current => current ? undefined : photo, { applyLocally: false });
        if (result.committed) return;
      }
      throw new Error(FULL_MESSAGE);
    } catch (error) {
      await deleteGalleryPhotoFiles(id);
      throw error;
    }
  }

  return <section className="salon-manager" aria-label="Moje zdjęcia w galerii">
    <div className="salon-section-heading"><div><span className="salon-overline">GALERIA</span><h2>Moje zdjęcia</h2></div></div>
    <p>Zdjęcia, które tu dodasz, od razu pojawiają się w galerii na stronie i są podpisane Twoim imieniem. Możesz usuwać tylko swoje zdjęcia.</p>
    <div className="salon-manager-grid" aria-busy={!loaded}>
      {!loaded ? [0, 1, 2].map(item => <article className="salon-manager-skeleton skeleton-block" key={item} aria-hidden="true" />) : mine.map(({ slot, photo }, index) => <article key={slot}>
        <GalleryPhoto photo={photo} sizes="(max-width: 700px) 50vw, 340px" />
        <span>Zdjęcie {index + 1}</span>
        <div>
          <button type="button" aria-label="Usuń zdjęcie" disabled={busy} onClick={async () => {
            if (await confirmAction({ title: "Usunąć zdjęcie z galerii?", message: "Zdjęcie zniknie ze strony salonu.", confirmLabel: "Usuń zdjęcie", tone: "danger" })) void perform(async () => {
              await remove(ref(realtimeDb, `shopfront/gallery/${slot}`));
              if (photo.storage) await deleteGalleryPhotoFiles(photo.id);
            }, "Zdjęcie zostało usunięte.");
          }}><Trash2 /></button>
        </div>
      </article>)}
    </div>
    {loaded && mine.length === 0 && <p className="salon-feedback">Nie dodałeś jeszcze żadnego zdjęcia.</p>}
    <label className="salon-upload"><Plus aria-hidden="true" />{busy ? "Zapisywanie…" : `Dodaj zdjęcie (w galerii ${entries.length}/${GALLERY_MAX_PHOTOS})`}
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !loaded || full} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void perform(() => addPhoto(file), "Zdjęcie dodane do galerii.");
      }} />
    </label>
    {feedback && <p role="status" className="salon-feedback">{feedback}</p>}
  </section>;
}
