"use client";

type DiagnosticType = "javascript" | "promise" | "resource" | "network" | "react";
type DiagnosticReport = {
  type: DiagnosticType;
  message: string;
  stack: string;
  route: string;
  screen: string;
  deviceId: string;
  occurredAt: number;
  device: {
    browser: string;
    os: string;
    viewport: string;
    installed: boolean;
    online: boolean;
    connection: string;
  };
};

const endpoint = "/api/client-errors";
const queueKey = "bnb-diagnostic-queue-v1";
const deviceKey = "bnb-diagnostic-device-v1";
const maxQueueSize = 20;
const retryDelayMs = 350;
// A phone waking up a sleeping app often needs a second or two before the first request gets through.
const laterRetryDelaysMs = [1500];
const staleBuildReloadKey = "bnb-stale-build-reload-at";
// Messages of things that are not faults of the app: the browser closing its own storage while the page is
// hidden, a sign-in refresh without a network, an animation another one replaced.
const harmlessMessage = /Database is closing\/hidden|auth\/network-request-failed|Transition was (aborted|skipped)/i;
// The page still asks for files of a version that has been replaced by a newer deployment.
const staleBuildMessage = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
// Only files this app ships count; a stylesheet injected by some other tool is none of our business.
const ownFilePrefixes = ["/assets/", "/brand/", "/icons/", "/fonts/"];
const recentFingerprints = new Map<string, number>();
let monitoringStarted = false;
let originalFetch: typeof window.fetch | null = null;

const cleanText = (value: unknown, limit: number) => {
  const source = value instanceof Error ? value.message : typeof value === "string" ? value : String(value ?? "");
  return source
    .slice(0, limit)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[e-mail]")
    .replace(/\b(?:\+?\d[\s().-]*){7,}\d\b/g, "[telefon]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]")
    .replace(/([?&](?:token|key|code|email|phone|name)=)[^&#\s]+/gi, "$1[ukryto]");
};

const readDeviceId = () => {
  try {
    const current = localStorage.getItem(deviceKey);
    if (current) return current;
    const next = crypto.randomUUID();
    localStorage.setItem(deviceKey, next);
    return next;
  } catch {
    return "session-anonymous";
  }
};

const identifyDevice = () => {
  const ua = navigator.userAgent;
  const browser = /Edg\/([\d.]+)/.exec(ua)?.[1]
    ? `Edge ${/Edg\/([\d.]+)/.exec(ua)?.[1]}`
    : /CriOS\/([\d.]+)/.exec(ua)?.[1]
      ? `Chrome iOS ${/CriOS\/([\d.]+)/.exec(ua)?.[1]}`
      : /Chrome\/([\d.]+)/.exec(ua)?.[1]
        ? `Chrome ${/Chrome\/([\d.]+)/.exec(ua)?.[1]}`
        : /Version\/([\d.]+).*Safari/.exec(ua)?.[1]
          ? `Safari ${/Version\/([\d.]+).*Safari/.exec(ua)?.[1]}`
          : /Firefox\/([\d.]+)/.exec(ua)?.[1]
            ? `Firefox ${/Firefox\/([\d.]+)/.exec(ua)?.[1]}`
            : "Inna przeglądarka";
  const os = /Android\s([\d.]+)/.exec(ua)?.[1]
    ? `Android ${/Android\s([\d.]+)/.exec(ua)?.[1]}`
    : /(?:iPhone|iPad).*OS\s([\d_]+)/.exec(ua)?.[1]
      ? `iOS ${/(?:iPhone|iPad).*OS\s([\d_]+)/.exec(ua)?.[1].replaceAll("_", ".")}`
      : /Windows NT/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : "Inny system";
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  }).connection;
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return {
    browser,
    os,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    installed: window.matchMedia("(display-mode: standalone)").matches || standaloneNavigator.standalone === true,
    online: navigator.onLine,
    connection: `${connection?.effectiveType ?? "nieznane"}${connection?.saveData ? ", oszczędzanie danych" : ""}`,
  };
};

const currentScreen = () => document.body.dataset.bnbScreen ||
  (document.querySelector(".booking-wizard") ? "kreator-rezerwacji" :
    document.querySelector(".admin-view") ? "panel" : "strona-glowna");

const readQueue = (): DiagnosticReport[] => {
  try {
    const value = JSON.parse(localStorage.getItem(queueKey) ?? "[]");
    return Array.isArray(value) ? value.slice(-maxQueueSize) : [];
  } catch {
    return [];
  }
};

const writeQueue = (reports: DiagnosticReport[]) => {
  try {
    localStorage.setItem(queueKey, JSON.stringify(reports.slice(-maxQueueSize)));
  } catch {
    // Monitoring must never interfere with the booking flow.
  }
};

const flushQueue = async () => {
  if (!navigator.onLine || !originalFetch) return;
  const pending = readQueue();
  if (!pending.length) return;
  const remaining = [...pending];
  for (const report of pending) {
    try {
      const response = await originalFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
        keepalive: true,
      });
      if (!response.ok && response.status !== 429) break;
      remaining.shift();
    } catch {
      break;
    }
  }
  writeQueue(remaining);
};

export const reportClientError = (
  type: DiagnosticType,
  message: unknown,
  stack: unknown = "",
) => {
  if (typeof window === "undefined") return;
  const cleanMessage = cleanText(message, 500) || "Nieznany błąd aplikacji";
  if (/ResizeObserver loop|Script error\.?$/i.test(cleanMessage) || harmlessMessage.test(cleanMessage)) return;
  if (staleBuildMessage.test(cleanMessage)) {
    reloadForNewBuild();
    return;
  }
  const cleanStack = cleanText(stack, 1800);
  const fingerprint = `${type}|${cleanMessage}|${cleanStack.split("\n")[0]}|${location.pathname}`;
  const now = Date.now();
  if (now - (recentFingerprints.get(fingerprint) ?? 0) < 60_000) return;
  recentFingerprints.set(fingerprint, now);
  const report: DiagnosticReport = {
    type,
    message: cleanMessage,
    stack: cleanStack,
    route: location.pathname,
    screen: currentScreen(),
    deviceId: readDeviceId(),
    occurredAt: now,
    device: identifyDevice(),
  };
  writeQueue([...readQueue(), report]);
  void flushQueue();
};

/** A deployment replaced the files this page was built from: one reload brings the new version, never in a loop. */
const reloadForNewBuild = () => {
  if (!navigator.onLine) return;
  try {
    if (Date.now() - (Number(sessionStorage.getItem(staleBuildReloadKey)) || 0) < 60_000) return;
    sessionStorage.setItem(staleBuildReloadKey, String(Date.now()));
  } catch {
    return;
  }
  window.location.reload();
};

const errorArgument = (value: unknown) => value instanceof Error
  ? { message: value.message, stack: value.stack ?? "" }
  : { message: typeof value === "string" || typeof value === "number" ? String(value) : "Błąd zapisany w konsoli", stack: "" };

const isCancelledRequest = (error: unknown, signal?: AbortSignal | null) =>
  Boolean(signal?.aborted) || (error as { name?: unknown } | null)?.name === "AbortError";

const waitBeforeRetry = () => new Promise<void>((resolve) => window.setTimeout(resolve, retryDelayMs));

export const startClientErrorMonitoring = () => {
  if (monitoringStarted || typeof window === "undefined") return () => undefined;
  monitoringStarted = true;
  originalFetch = window.fetch.bind(window);
  const nativeConsoleError = console.error.bind(console);

  const onError = (event: ErrorEvent | Event) => {
    if (event instanceof ErrorEvent) {
      reportClientError("javascript", event.message, event.error?.stack ?? `${event.filename}:${event.lineno}:${event.colno}`);
      return;
    }
    const target = event.target as HTMLElement | null;
    const resource = target && "src" in target ? String((target as HTMLImageElement).src) :
      target && "href" in target ? String((target as HTMLLinkElement).href) : "zasób aplikacji";
    try {
      const path = new URL(resource, location.href).pathname;
      // Nothing to report while offline or in the background, or for files that are not this app's.
      if (!navigator.onLine || document.visibilityState === "hidden") return;
      if (!ownFilePrefixes.some((prefix) => path.startsWith(prefix))) return;
      reportClientError("resource", `Nie udało się wczytać: ${path}`);
    } catch {
      reportClientError("resource", "Nie udało się wczytać zasobu aplikacji");
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const detail = errorArgument(event.reason);
    reportClientError("promise", detail.message, detail.stack);
  };
  const onOnline = () => void flushQueue();
  // Vite reports a page chunk it cannot load (an old page after a new deployment) with this event.
  const onPreloadError = (event: Event) => {
    event.preventDefault();
    reloadForNewBuild();
  };

  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("online", onOnline);
  window.addEventListener("vite:preloadError", onPreloadError);
  console.error = (...values: unknown[]) => {
    nativeConsoleError(...values);
    const detail = errorArgument(values.find((value) => value instanceof Error) ?? values[0]);
    reportClientError("javascript", detail.message, detail.stack);
  };
  window.fetch = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requestUrl, location.href);
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
    const monitored = url.origin === location.origin && url.pathname !== endpoint;
    const retryable = monitored && method === "GET";
    let retried = false;
    let response: Response;
    try {
      response = await originalFetch!(input, init);
    } catch (error) {
      if (!retryable || isCancelledRequest(error, signal) || !navigator.onLine) {
        if (monitored && !isCancelledRequest(error, signal) && navigator.onLine && document.visibilityState !== "hidden") {
          reportClientError("network", `${method} ${url.pathname}: brak odpowiedzi`, error);
        }
        throw error;
      }
      retried = true;
      let lastError: unknown = error;
      let recovered: Response | null = null;
      for (const delay of [retryDelayMs, ...laterRetryDelaysMs]) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
        if (signal?.aborted || !navigator.onLine) throw lastError;
        try {
          recovered = await originalFetch!(input, init);
          break;
        } catch (retryError) {
          lastError = retryError;
          if (isCancelledRequest(retryError, signal)) throw retryError;
        }
      }
      if (!recovered) {
        if (navigator.onLine && document.visibilityState !== "hidden") {
          reportClientError("network", `${method} ${url.pathname}: brak odpowiedzi`, lastError);
        }
        throw lastError;
      }
      response = recovered;
    }
    if (monitored && response.status >= 500 && retryable && !retried && !signal?.aborted && navigator.onLine) {
      await waitBeforeRetry();
      if (!signal?.aborted && navigator.onLine) {
        try {
          response = await originalFetch!(input, init);
        } catch (retryError) {
          if (!isCancelledRequest(retryError, signal)) {
            reportClientError("network", `${method} ${url.pathname}: brak odpowiedzi`, retryError);
          }
          throw retryError;
        }
      }
    }
    if (monitored && response.status >= 500) {
      // The server's own explanation, when it gave one, tells the owner what actually failed.
      const reason = await response.clone().json().then((body) => cleanText((body as { error?: unknown })?.error ?? "", 160)).catch(() => "");
      reportClientError("network", `${method} ${url.pathname}: HTTP ${response.status}${reason ? ` (${reason})` : ""}`);
    }
    return response;
  };
  void flushQueue();

  return () => {
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("vite:preloadError", onPreloadError);
    console.error = nativeConsoleError;
    if (originalFetch) window.fetch = originalFetch;
    monitoringStarted = false;
  };
};
