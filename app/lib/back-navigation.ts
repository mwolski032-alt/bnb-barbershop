import { createBackController } from "../../shared/back-navigation.mjs";
import { guardHistoryTraversal } from "../../shared/history-guard.mjs";

type Controller = ReturnType<typeof createBackController>;

let controller: Controller | null = null;

/** One controller per page, created on first use in the browser. It owns the single popstate listener. */
export function getBackController(): Controller {
  if (!controller) {
    // Must happen before the first history move: see shared/history-guard.mjs.
    guardHistoryTraversal(window as unknown as Record<string, unknown>);
    const created = createBackController({
      history: window.history,
      setTimeout: (callback: () => void, delay: number) => window.setTimeout(callback, delay),
      now: () => Date.now(),
    });
    window.addEventListener("popstate", (event) => created.onPopState(event));
    controller = created;
  }
  return controller;
}