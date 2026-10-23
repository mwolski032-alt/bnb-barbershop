"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

const EXIT_MS = 150;

/** `children` may be a function that receives `close`, which plays the exit animation first. */
export default function SalonDialog({ title, children, onClose, wide = false, gallery = false, className = "" }: {
  title: string; children: ReactNode | ((close: () => void) => ReactNode); onClose: () => void; wide?: boolean; gallery?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const latestClose = useRef(onClose);
  useEffect(() => { latestClose.current = onClose; }, [onClose]);
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
  // Play the exit animation first, then let the parent unmount the dialog.
  useEffect(() => {
    if (!closing) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => latestClose.current(), reduced ? 0 : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);
  const requestClose = useCallback(() => setClosing(true), []);
  return <dialog ref={dialog} className={`salon-dialog ${wide ? "salon-lightbox" : ""} ${gallery ? "salon-gallery-dialog" : ""} ${className}`.trim()}
    data-closing={closing || undefined}
    aria-label={title} onCancel={(event) => { event.preventDefault(); requestClose(); }} onClick={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}>
    <div className="salon-dialog-content">
      <button className="salon-close" type="button" aria-label="Zamknij okno" onClick={requestClose}><X /></button>
      {typeof children === "function" ? children(requestClose) : children}
    </div>
  </dialog>;
}
