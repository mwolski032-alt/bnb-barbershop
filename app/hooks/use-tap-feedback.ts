"use client";
import { useEffect } from "react";

const TARGET = 'button, [role="button"], [role="tab"], [role="radio"], summary, a[class]';

/** Small controls squash more, big cards only a hair, so nothing ever looks like it is jumping. */
const scaleFor = (box: DOMRect) => {
  const smallSide = Math.min(box.width, box.height);
  if (smallSide <= 48 && box.width <= 120) return 0.86;
  if (box.width > 260 && box.height > 110) return 0.985;
  if (box.width > 160) return 0.965;
  return 0.94;
};

const isDisabled = (element: Element) =>
  (element as HTMLButtonElement).disabled === true || element.getAttribute("aria-disabled") === "true";

/**
 * Gives every tap on a button the same physical answer: it presses in (CSS :active), springs back with a
 * little overshoot on release, its icon hops and turns, and a soft ring spreads from the finger.
 * One delegated listener serves the whole app, so no button needs touching.
 */
export function useTapFeedback() {
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return undefined;

    const pressed = new Set<HTMLElement>();

    const onDown = (event: PointerEvent) => {
      if (event.button > 0) return;
      const target = (event.target as Element | null)?.closest<HTMLElement>(TARGET);
      if (!target || isDisabled(target)) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty("--tap-scale", String(scaleFor(box)));
      target.classList.remove("tap-release");
      pressed.add(target);

      if (document.documentElement.classList.contains("reduced-effects")) return;
      // Ring: only for controls of a sensible size, so a huge photo card does not flash.
      if (box.width > 340 && box.height > 140) return;
      const ring = document.createElement("span");
      const size = Math.min(96, Math.max(44, Math.max(box.width, box.height) * 0.7));
      ring.className = "tap-ripple";
      ring.setAttribute("aria-hidden", "true");
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      ring.style.setProperty("--tap-size", `${size}px`);
      ring.style.setProperty("--tap-color", getComputedStyle(target).color);
      ring.addEventListener("animationend", () => ring.remove(), { once: true });
      document.body.appendChild(ring);
    };

    const release = () => {
      for (const element of pressed) {
        // Elements that run their own animation (pulsing, sheen) keep it instead of being restarted.
        const own = getComputedStyle(element).animationName;
        if (own && own !== "none") continue;
        const box = element.getBoundingClientRect();
        element.style.setProperty("--tap-scale", String(scaleFor(box)));
        void element.offsetWidth;
        element.classList.add("tap-release");
        const done = () => {
          element.classList.remove("tap-release");
          element.style.removeProperty("--tap-scale");
        };
        element.addEventListener("animationend", (event) => {
          if (event.target === element) done();
        }, { once: true });
        window.setTimeout(done, 700);
      }
      pressed.clear();
    };

    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
    };
  }, []);
}
