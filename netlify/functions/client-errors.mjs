import crypto from "node:crypto";
import {
  getAccessToken,
  getAdminContext,
  jsonResponse,
  readDatabaseQuery,
  readDatabaseWithEtag,
  verifyRequestUser,
  writeDatabaseIfUnchanged,
} from "./_firebase-admin.mjs";
import {
  diagnosticFingerprint,
  normalizeClientErrorReport,
} from "../../shared/error-monitoring.mjs";

const reportsPath = "clientErrorReports";
const rateWindowMs = 10 * 60 * 1000;
const maxReportsPerWindow = 12;
const rateLimits = new Map();

export const config = {
  path: "/api/client-errors",
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

const allowedOrigin = (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "bnbbarber.netlify.app" || hostname === "localhost" ||
      hostname === "127.0.0.1" || hostname.endsWith("--bnbbarber.netlify.app");
  } catch {
    return false;
  }
};

const claimReportSlot = (deviceKey) => {
  const now = Date.now();
  const recent = (rateLimits.get(deviceKey) ?? []).filter((time) => now - time < rateWindowMs);
  if (recent.length >= maxReportsPerWindow) return false;
  recent.push(now);
  rateLimits.set(deviceKey, recent);
  if (rateLimits.size > 1000) {
    for (const [key, times] of rateLimits) {
      if (!times.some((time) => now - time < rateWindowMs)) rateLimits.delete(key);
    }
  }
  return true;
};

const requireOwner = async (request, accessToken) => {
  const user = await verifyRequestUser(request);
  if (!user) return null;
  const context = await getAdminContext(user, accessToken);
  return context.isOwner && context.active ? user : null;
};

const storeReport = async (report, accessToken) => {
  const release = String(process.env.COMMIT_REF || process.env.DEPLOY_ID || "local").slice(0, 40);
  const fingerprint = diagnosticFingerprint(report, release);
  const path = `${reportsPath}/${fingerprint}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { etag, value } = await readDatabaseWithEtag(path, accessToken);
    const now = Date.now();
    const next = {
      id: fingerprint,
      type: report.type,
      message: report.message,
      stack: report.stack,
      route: report.route,
      screen: report.screen,
      device: report.device,
      release,
      count: Math.min(999999, Math.max(0, Number(value?.count) || 0) + 1),
      firstSeenAt: Number(value?.firstSeenAt) || now,
      lastSeenAt: now,
      clientOccurredAt: report.occurredAt || now,
      resolvedAt: null,
    };
    if (await writeDatabaseIfUnchanged(path, next, etag || "null_etag", accessToken)) return;
  }
  throw new Error("Concurrent monitoring update failed.");
};

export default async function handler(request) {
  try {
    if (request.method === "POST") {
      if (!allowedOrigin(request)) return jsonResponse({ error: "Origin not allowed" }, 403);
      if (!String(request.headers.get("content-type") ?? "").includes("application/json")) {
        return jsonResponse({ error: "Expected JSON" }, 415);
      }
      const declaredLength = Number(request.headers.get("content-length") || 0);
      if (declaredLength > 12_000) return jsonResponse({ error: "Report too large" }, 413);
      const rawBody = await request.text();
      if (rawBody.length > 12_000) return jsonResponse({ error: "Report too large" }, 413);
      let value;
      try {
        value = JSON.parse(rawBody);
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      const report = normalizeClientErrorReport(value);
      const deviceKey = crypto.createHash("sha256").update(report.deviceId || "anonymous").digest("hex");
      if (!claimReportSlot(deviceKey)) return jsonResponse({ accepted: false, limited: true }, 429);
      const accessToken = await getAccessToken();
      await storeReport(report, accessToken);
      return jsonResponse({ accepted: true }, 202);
    }

    const accessToken = await getAccessToken();
    const owner = await requireOwner(request, accessToken);
    if (!owner) return jsonResponse({ error: "Owner access required" }, 403);

    if (request.method === "GET") {
      const value = await readDatabaseQuery(
        reportsPath,
        { orderBy: "lastSeenAt", limitToLast: 100 },
        accessToken,
      ) ?? {};
      const reports = Object.values(value).sort(
        (first, second) => Number(second.lastSeenAt) - Number(first.lastSeenAt),
      );
      return jsonResponse({ reports });
    }

    if (request.method === "PATCH") {
      const payload = await request.json();
      const id = String(payload?.id ?? "");
      if (!/^[a-f0-9]{32}$/.test(id)) return jsonResponse({ error: "Invalid report id" }, 400);
      const path = `${reportsPath}/${id}`;
      const { etag, value } = await readDatabaseWithEtag(path, accessToken);
      if (!value) return jsonResponse({ error: "Report not found" }, 404);
      const next = { ...value, resolvedAt: payload?.resolved === false ? null : Date.now() };
      const saved = await writeDatabaseIfUnchanged(path, next, etag || "null_etag", accessToken);
      return saved
        ? jsonResponse({ report: next })
        : jsonResponse({ error: "Report changed. Refresh and retry." }, 409);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("Client error monitor request failed", error);
    return jsonResponse({ error: "Monitoring service unavailable" }, 503);
  }
}
