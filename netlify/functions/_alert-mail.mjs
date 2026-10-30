// One short e-mail to the owner (watchdog alerts, housekeeping report). Powiadomienia właściciela are switched off in the app,
// so this is the one way the business owner hears about a problem. Needs RESEND_API_KEY and RESEND_FROM_EMAIL in Netlify.

export const ALERT_EMAIL = process.env.ALERT_EMAIL || "bnbbarbershop2.0@gmail.com";

/** Returns { ok, reason }. Never throws: a missing mail setup must not break the job that wanted to report. */
export const sendOwnerEmail = async ({ subject, text }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false, reason: "RESEND_API_KEY lub RESEND_FROM_EMAIL nie jest ustawione w Netlify." };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [ALERT_EMAIL],
        subject,
        text,
        ...(process.env.RESEND_REPLY_TO ? { reply_to: process.env.RESEND_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok ? { ok: true } : { ok: false, reason: `Resend odpowiedział ${response.status}.` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Nie udało się wysłać e-maila." };
  }
};
