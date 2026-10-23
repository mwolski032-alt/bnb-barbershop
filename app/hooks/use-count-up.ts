import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts from the current value to `target` with an ease-out curve. Reduced motion jumps straight there. */
export function useCountUp(target: number, { duration = 1100, delay = 0, decimals = 0 } = {}) {
  const [value, setValue] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const factor = 10 ** decimals;
    const settle = (next: number) => {
      current.current = next;
      setValue(next);
    };
    if (prefersReducedMotion() || duration <= 0) {
      settle(target);
      return undefined;
    }
    const from = current.current;
    let frame = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - progress) ** 3;
        settle(Math.round((from + (target - from) * eased) * factor) / factor);
        if (progress < 1) frame = window.requestAnimationFrame(step);
      };
      frame = window.requestAnimationFrame(step);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [target, duration, delay, decimals]);

  return value;
}
