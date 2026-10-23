import { buildIcs, eventFromCalendarQuery } from "../../shared/calendar-ics.mjs";

export const config = {
  path: "/api/calendar.ics",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

// Turns the event in the query string into an .ics. Served inline, so iPhones open "Add to Calendar"
// straight away instead of saving a file. It stores nothing and needs no sign-in: the content is only
// what the visitor sent, escaped and length-limited.
export default async function handler(request) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const event = eventFromCalendarQuery(new URL(request.url).searchParams);
  if (!event) return new Response("Nieprawidłowe dane wydarzenia.", { status: 400 });
  return new Response(buildIcs(event), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="wizyta-bnb.ics"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
