// Injected by vite.config.ts at build time (see `define` there). Absent in plain test runs.
declare const __BNB_BUILD__: { commit: string; builtAt: string } | undefined;

/** "main · a1b2c3d · 25 paź, 16:42": which commit of main this build is and when it was built (Warsaw time). */
export const buildLabel = (): string => {
  if (typeof __BNB_BUILD__ === "undefined") return "";
  const built = new Date(__BNB_BUILD__.builtAt);
  const when = Number.isNaN(built.getTime()) ? "" : built.toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });
  return ["main", __BNB_BUILD__.commit, when].filter(Boolean).join(" · ");
};
