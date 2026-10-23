"use client";
import { useEffect, useState, type ReactNode } from "react";

const EXIT_MS = 150;

/**
 * Keeps a conditionally rendered modal on screen just long enough to fade out.
 *
 * Usage: `<ModalPresence>{open ? <div className="client-modal-backdrop">…</div> : null}</ModalPresence>`.
 * While `open` is true the children render as usual and are remembered. When they disappear, the
 * last rendered copy stays for EXIT_MS with `data-leaving` set (CSS fades it and blocks clicks).
 */
export default function ModalPresence({ children }: { children: ReactNode }) {
  // Compare the children exactly as passed: they are stable across this component's own re-renders.
  const current = children || null;
  const [shown, setShown] = useState<ReactNode>(current);
  const [leaving, setLeaving] = useState(false);

  if (current && shown !== current) setShown(current);
  if (current && leaving) setLeaving(false);
  if (!current && shown && !leaving) setLeaving(true);

  useEffect(() => {
    if (!leaving) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => { setShown(null); setLeaving(false); }, reduced ? 0 : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return shown ? <div className="modal-presence" data-leaving={leaving || undefined}>{shown}</div> : null;
}
