"use client";
import GalleryPhoto from "./gallery-photo";
import type { SalonImage } from "./salon-manager";

const SHOWN = 8;

/** A barber's own photos as small squares at the bottom of their profile; a tap opens the viewer on that photo. */
export default function BarberWorks({ name, photos, onOpen }: { name: string; photos: SalonImage[]; onOpen: (photos: SalonImage[], index: number) => void }) {
  if (photos.length === 0) return null;
  const hidden = photos.length - SHOWN;
  return <section className="barber-works" aria-label={`Prace: ${name}`}>
    <h3>Prace <span>{photos.length}</span></h3>
    <div className="barber-works-grid">
      {photos.slice(0, SHOWN).map((photo, index) => <button type="button" key={photo.id} style={{ animationDelay: `${index * 55}ms` }}
        aria-label={`Powiększ pracę ${index + 1} z ${photos.length}: ${name}`} onClick={() => onOpen(photos, index)}>
        <GalleryPhoto photo={photo} sizes="88px" alt="" />
        {hidden > 0 && index === SHOWN - 1 && <span className="barber-works-more" aria-hidden="true">+{hidden}</span>}
      </button>)}
    </div>
  </section>;
}
