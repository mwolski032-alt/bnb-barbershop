"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function SalonDialog({ title, children, onClose, wide = false, gallery = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean; gallery?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  return <dialog ref={dialog} className={`salon-dialog ${wide ? "salon-lightbox" : ""} ${gallery ? "salon-gallery-dialog" : ""}`}
    aria-label={title} onCancel={onClose} onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
    <div className="salon-dialog-content">
      <button className="salon-close" type="button" aria-label="Zamknij okno" onClick={onClose}><X /></button>
      {children}
    </div>
  </dialog>;
}
