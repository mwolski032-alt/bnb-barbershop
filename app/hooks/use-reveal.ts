import { useEffect, type RefObject } from "react";

/**
 * Fade-and-rise elements marked with `data-reveal` the first time they scroll into view.
 * Content stays fully visible without IntersectionObserver or before this effect runs,
 * so nothing is ever hidden permanently. `signature` re-scans when new content appears.
 */
export function useReveal(root: RefObject<HTMLElement | null>, signature: string | number) {
  useEffect(() => {
    const container = root.current;
    if (!container || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    container.classList.add("reveal-ready");
    container.querySelectorAll("[data-reveal]:not(.is-visible)").forEach((element) => {
      // Already on screen: show right away instead of waiting for the observer's first callback.
      const { top, bottom } = element.getBoundingClientRect();
      if (top < window.innerHeight && bottom > 0) element.classList.add("is-visible");
      else observer.observe(element);
    });
    return () => observer.disconnect();
  }, [root, signature]);
}
