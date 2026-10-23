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
  if (/ResizeObserver loop|Script error\.?$/i.test(cleanMessage)) return;
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
      reportClientError("resource", `Nie udało się wczytać: ${new URL(resource, location.href).pathname}`);
    } catch {
      reportClientError("resource", "Nie udało się wczytać zasobu aplikacji");
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const detail = errorArgument(event.reason);
    reportClientError("promise", detail.message, detail.stack);
  };
  const onOnline = () => void flushQueue();

  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("online", onOnline);
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
        if (monitored && !isCancelledRequest(error, signal) && navigator.onLine) {
          reportClientError("network", `${method} ${url.pathname}: brak odpowiedzi`, error);
        }
        throw error;
      }
      await waitBeforeRetry();
      if (signal?.aborted || !navigator.onLine) throw error;
      retried = true;
      try {
        response = await originalFetch!(input, init);
      } catch (retryError) {
        if (!isCancelledRequest(retryError, signal) && navigator.onLine) {
          reportClientError("network", `${method} ${url.pathname}: brak odpowiedzi`, retryError);
        }
        throw retryError;
      }
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
      reportClientError("network", `${method} ${url.pathname}: HTTP ${response.status}`);
    }
    return response;
  };
  void flushQueue();

  return () => {
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("online", onOnline);
    console.error = nativeConsoleError;
    if (originalFetch) window.fetch = originalFetch;
    monitoringStarted = false;
  };
};
