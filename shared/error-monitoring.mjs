import crypto from "node:crypto";

const textLimit = (value, length) => String(value ?? "").trim().slice(0, length);

export const redactDiagnosticText = (value, length = 700) =>
  textLimit(value, length)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[e-mail]")
    .replace(/\b(?:\+?\d[\s().-]*){7,}\d\b/g, "[telefon]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]")
    .replace(/([?&](?:token|key|code|email|phone|name)=)[^&#\s]+/gi, "$1[ukryto]")
    .replace(/file:\/\/\/[A-Za-z]:\/[^\s)]+/gi, "[lokalny-plik]");

export const normalizeDiagnosticRoute = (value) => {
  const input = textLimit(value, 300);
  try {
    const parsed = new URL(input, "https://bnbbarber.netlify.app");
    return textLimit(parsed.pathname || "/", 160);
  } catch {
    return "/";
  }
};

const allowedTypes = new Set(["javascript", "promise", "resource", "network", "react"]);

export const normalizeClientErrorReport = (value = {}) => {
  const report = value && typeof value === "object" ? value : {};
  const device = report.device && typeof report.device === "object" ? report.device : {};
  const message = redactDiagnosticText(report.message, 500) || "Nieznany błąd aplikacji";
  return {
    type: allowedTypes.has(report.type) ? report.type : "javascript",
    message,
    stack: redactDiagnosticText(report.stack, 1800),
    route: normalizeDiagnosticRoute(report.route),
    screen: textLimit(report.screen, 80) || "nieznany",
    deviceId: textLimit(report.deviceId, 80),
    occurredAt: Math.max(0, Number(report.occurredAt) || 0),
    device: {
      browser: textLimit(device.browser, 60) || "Nieznana przeglądarka",
      os: textLimit(device.os, 60) || "Nieznany system",
      viewport: /^\d{2,5}x\d{2,5}$/.test(String(device.viewport ?? ""))
        ? String(device.viewport)
        : "nieznany",
      installed: device.installed === true,
      online: device.online !== false,
      connection: textLimit(device.connection, 30) || "nieznane",
    },
  };
};

export const diagnosticFingerprint = (report, release = "unknown") =>
  crypto
    .createHash("sha256")
    .update([release, report.type, report.message, report.stack.split("\n")[0], report.route].join("|"))
    .digest("hex")
    .slice(0, 32);

