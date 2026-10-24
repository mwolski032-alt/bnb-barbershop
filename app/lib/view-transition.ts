import { flushSync } from "react-dom";

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => {
    finished?: Promise<unknown>;
    ready?: Promise<unknown>;
    updateCallbackDone?: Promise<unknown>;
  } | undefined;
};

/**
 * Run a state change as a smooth cross-fade between two screens (View Transitions API).
 * Browsers without support, and people who prefer reduced motion, get the plain instant update.
 */
export function withViewTransition(update: () => void) {
  const doc = document as TransitionDocument;
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  // Decorative loops (aurora, Ken Burns, shimmer) rest while the browser cross-fades two whole screens.
  const root = document.documentElement;
  root.classList.add("vt-running");
  const transition = doc.startViewTransition(() => { flushSync(update); });
  const done = () => root.classList.remove("vt-running");
  if (transition?.finished) transition.finished.then(done, done);
  // A transition that is skipped or aborted (a newer one starts, the tab is hidden) rejects these promises too.
  // Nothing waits for them, and an unhandled rejection would only be reported as an error.
  transition?.ready?.catch(() => undefined);
  transition?.updateCallbackDone?.catch(() => undefined);
  // Never leave the loops paused if the browser does not report the end (for example a hidden tab).
  window.setTimeout(done, 1500);
}
