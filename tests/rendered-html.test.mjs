import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the BNB booking app shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="pl"/i);
  assert.match(html, /BNB Barbershop/);
  assert.match(html, /Rezerwacja wizyty/);
  assert.match(html, /\/brand\/bnb-logo\.png/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site|codex-preview/i);
});

test("keeps BNB metadata and production assets wired", async () => {
  const [page, layout, manifest, serviceWorker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(page, /BNB Barbershop \| Rezerwacja wizyty/);
  assert.match(page, /<BookingHome \/>/);
  assert.match(layout, /applicationName:\s*"BNB Barbershop"/);
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest\?v=3"/);
  assert.match(manifest, /"name":\s*"BNB Barbershop"/);
  assert.match(serviceWorker, /bnb-barbershop-v3/);
});

test("keeps the premium client booking flow and safety controls", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /Twoja najbliższa wizyta/);
  assert.match(bookingHome, /className="booking-progress"/);
  assert.match(bookingHome, /Potwierdź nowy termin/);
  assert.match(bookingHome, /Odwołaj wizytę/);
  assert.match(bookingHome, /if \(direction === -1 && !canShiftToPreviousMonth\) return/);
  assert.match(bookingHome, /event\.key !== "Escape"/);
  assert.match(bookingHome, /silentNewAppointmentToastIdRef/);
  assert.match(bookingHome, /unseen\.appointmentId === silentAppointmentId/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.client-service-picker \.service-list/);
});

test("keeps the client-focused sign-in experience concise", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /Twój następny termin/);
  assert.match(bookingHome, /Rezerwacja w mniej niż minutę/);
  assert.match(bookingHome, /Przypomnienie przed wizytą/);
  assert.doesNotMatch(bookingHome, /Bez podglądu cudzych rezerwacji/);
  assert.doesNotMatch(bookingHome, /Łatwiejsze przesunięcie wizyty/);
  assert.match(styles, /\.auth-benefits span::before/);
});

test("keeps the mobile booking gestures and bottom-sheet interactions", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /beginCalendarGesture/);
  assert.match(bookingHome, /Math\.abs\(deltaX\) < 52/);
  assert.match(bookingHome, /scrollToBookingSection/);
  assert.match(bookingHome, /client-bottom-sheet appointment-detail-sheet/);
  assert.match(bookingHome, /role="alertdialog"/);
  assert.doesNotMatch(bookingHome, /window\.confirm\("Czy na pewno odwołać tę wizytę\?"\)/);
  assert.match(styles, /\.client-calendar\s*{[^}]*touch-action:\s*pan-y/s);
  assert.match(styles, /\.sheet-grabber\s*{/);
  assert.match(styles, /@keyframes sheet-in/);
  assert.match(styles, /@media \(max-width: 360px\)/);
});

test("keeps the professional admin client directory and SMS workflow", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /const getAdminClientId/);
  assert.match(bookingHome, /const adminClientProfiles = useMemo/);
  assert.match(bookingHome, /className="client-search"/);
  assert.match(bookingHome, /Historia wizyt/);
  assert.match(bookingHome, /sms-composer-modal/);
  assert.match(bookingHome, /Otwórz aplikację SMS/);
  assert.match(bookingHome, /Potwierdzam Twoją wizytę/);
  assert.match(styles, /\.client-directory-tools/);
  assert.match(styles, /\.admin-client-profile-modal/);
  assert.match(styles, /\.sms-template-picker/);
});

test("keeps the persistent client base and manual admin booking workflow", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /type ClientRecord/);
  assert.match(bookingHome, /ref\(realtimeDb, "clients"\)/);
  assert.match(bookingHome, /Baza klientów/);
  assert.match(bookingHome, /Dodaj klienta/);
  assert.match(bookingHome, /Zapisz i umów/);
  assert.match(bookingHome, /Poza grafikiem/);
  assert.match(bookingHome, /const handleSaveClientFromDialog = async/);
  assert.match(bookingHome, /const removeClientFromDirectory = async/);
  assert.match(bookingHome, /hiddenFor\/\$\{activeBarberId\}/);
  assert.match(bookingHome, /Historia wizyt,\s*terminarz i analiza pozostaną bez zmian/);
  assert.match(bookingHome, /Ten termin nakłada się na inną wizytę/);
  assert.match(bookingHome, /mutateAppointment<AdminAppointment>\("create_admin"/);
  assert.match(styles, /\.client-creator-modal/);
  assert.match(styles, /\.manual-booking-grid/);
  assert.match(styles, /\.book-client-button/);
  assert.match(styles, /\.remove-client-button/);
  assert.match(styles, /\.trash-icon/);
});

test("keeps the owner-only multi-barber workspace", async () => {
  const [bookingHome, styles, appointmentApi] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /ownerUserIds = new Set\(\["xkyDu2Lb1Ma8McF7yfyv8PIAj1M2"\]\)/);
  assert.match(bookingHome, /mateusz: "XxBe4dwVYWZPtl004J4tWq6AMZ73"/);
  assert.match(bookingHome, /kacper: "TVwF6j7ePiTFhiGTWWPrq9nmRvJ3"/);
  assert.match(bookingHome, /name: "Mateusz",[\s\S]*label: "Barber 1"/);
  assert.match(bookingHome, /name: "Kacper",[\s\S]*label: "Barber 2"/);
  assert.match(bookingHome, /Czyj panel chcesz otworzyć\?/);
  assert.match(bookingHome, /appointment\.barberId \|\| defaultBarberId/);
  assert.match(bookingHome, /barbers\/\$\{activeBarberId\}\/workSettings/);
  assert.match(bookingHome, /barbers\/\$\{activeBarberId\}\/services/);
  assert.match(appointmentApi, /barberIds\/\$\{proposed\.barberId\}/);
  assert.match(styles, /\.owner-barber-grid/);
  assert.match(styles, /\.selected-barber-context/);
});

test("keeps the scoped barber profile and centered client action", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /const isAdmin = isOwner \|\| isBarber/);
  assert.match(bookingHome, /signedInBarberId \?\? selectedBarberId \?\? defaultBarberId/);
  assert.match(bookingHome, /barbers\/\$\{activeBarberId\}\/profile/);
  assert.match(bookingHome, /adminSection === "profile"/);
  assert.match(bookingHome, /resizeProfilePhoto/);
  assert.match(styles, /\.barber-profile-view/);
  assert.match(styles, /\.add-client-button span::before/);
  assert.match(styles, /translate\(-50%, -50%\)/);
  assert.match(styles, /repeat\(var\(--admin-nav-items, 6\), minmax\(0, 1fr\)\)/);
});

test("keeps the mastered admin schedule and availability editor", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /className="schedule-mobile-agenda"/);
  assert.match(bookingHome, /className="schedule-date-controls"/);
  assert.match(bookingHome, /openSelectedDayInWorkEditor/);
  assert.match(bookingHome, /beginAvailabilityEdit/);
  assert.match(bookingHome, /pendingAvailabilityRemovalKey/);
  assert.match(bookingHome, /istniejące dni zostaną zaktualizowane/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /\.mobile-agenda-actions/);
  assert.match(styles, /\.work-feedback\.success/);
});

test("keeps settlement-driven admin analytics", async () => {
  const [bookingHome, styles, appointmentApi] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /\| "analytics"[\s\S]*\| "work"/);
  assert.match(bookingHome, /"cancelled" \| "completed"/);
  assert.match(bookingHome, /settlementAvailableAt\.setMinutes\([\s\S]*\+ 1\)/);
  assert.match(bookingHome, /const isPotentialNoShow/);
  assert.match(bookingHome, /const settleAdminAppointment = async/);
  assert.match(appointmentApi, /next\.status = "completed"/);
  assert.match(bookingHome, /const settledAmount = getServicePriceValue/);
  assert.match(appointmentApi, /next\.settlement = \{ barberId: next\.barberId/);
  assert.match(bookingHome, /aria-label="Analiza działalności"/);
  assert.match(bookingHome, /Potencjalne nieobecności/);
  assert.match(styles, /\.analytics-kpi-grid/);
  assert.match(styles, /\.analytics-chart/);
  assert.match(bookingHome, /visibleAdminSections\.map\(\(section\) =>/);
  assert.match(styles, /repeat\(var\(--admin-nav-items, 6\), minmax\(0, 1fr\)\)/);
});

test("keeps the fixed owner-managed team and role-aware admin avatars", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /type BarberAdminSection = Exclude<AdminSection, "team">/);
  assert.match(bookingHome, /ref\(realtimeDb, "team\/barbers"\)/);
  assert.match(bookingHome, /const updateTeamMemberActive = async/);
  assert.match(bookingHome, /const updateTeamMemberAccess = async/);
  assert.match(bookingHome, /className="team-management-view"/);
  assert.match(bookingHome, /className="client-appointment-modal team-member-dialog"/);
  assert.match(
    bookingHome,
    /photoUrl=\{isBarber \? activeBarberProfile\.photoUrl : activeUser\.photoURL\}/,
  );
  assert.match(bookingHome, /openOwnerBarberPanel\(member\.id, "schedule"\)/);
  assert.match(bookingHome, /openOwnerBarberPanel\(member\.id, "analytics"\)/);
  assert.match(bookingHome, /activeUser && teamReady/);
  assert.match(bookingHome, /configuredSignedInBarber\?\.active/);
  assert.match(bookingHome, /fixedBarberUserIds\[id\]/);
  assert.doesNotMatch(bookingHome, /Dodaj barbera/);
  assert.doesNotMatch(bookingHome, /createTeamInvitation/);
  assert.doesNotMatch(bookingHome, /Identyfikator użytkownika Firebase/);
  assert.match(styles, /\.team-member-card/);
  assert.match(styles, /\.team-access-grid/);
  assert.match(styles, /--admin-nav-items/);
});

test("keeps barber ownership and excludes the owner from appointment notifications", async () => {
  const [bookingHome, notifications, sendPush, appointmentApi] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/send-push.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /type Service = \{[\s\S]*barberId: string/);
  assert.match(bookingHome, /type Appointment = \{[\s\S]*barberId: string/);
  assert.match(bookingHome, /type AvailabilityWindow = \{[\s\S]*barberId: string/);
  assert.match(bookingHome, /servicesToRecord = \(items: Service\[\], barberId/);
  assert.match(bookingHome, /migrationUpdates\[`appointments\/\$\{id\}\/barberId`\]/);
  assert.match(bookingHome, /shouldRunDataMigration && isAdmin/);
  assert.match(appointmentApi, /next\.settlement = \{[\s\S]*amount/);
  assert.match(notifications, /barberId: string/);
  assert.match(sendPush, /process\.env\.BARBER_MATEUSZ_EMAIL/);
  assert.match(sendPush, /process\.env\.BARBER_KACPER_EMAIL/);
  assert.doesNotMatch(sendPush, /process\.env\.ADMIN_EMAIL/);
  assert.match(sendPush, /kacper: "TVwF6j7ePiTFhiGTWWPrq9nmRvJ3"/);
  assert.match(sendPush, /if \(!barberContact\.active\)/);
  assert.match(sendPush, /target: "barber"/);
  assert.match(sendPush, /uid === barberUserId/);
  assert.match(sendPush, /Owner SMS notifications are disabled/);
  assert.match(sendPush, /Owner WhatsApp notifications are disabled/);
  assert.match(bookingHome, /inAppNotifications\/\$\{activeUser\.uid\}/);
  assert.match(sendPush, /writeInAppNotifications/);
  assert.match(bookingHome, /!isOwner \? notificationButton : null/);
  assert.match(sendPush, /appointmentBarberId: eventAppointment\.barberId/);
});

test("separates active visits from the client directory", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /type ClientWorkspaceTab = "appointments" \| "directory"/);
  assert.match(bookingHome, /const activeAdminClientProfiles = useMemo/);
  assert.match(bookingHome, /role="tablist" aria-label="Widok bazy klientów"/);
  assert.match(bookingHome, /Aktywne wizyty/);
  assert.match(bookingHome, /clientWorkspaceTab === "directory"/);
  assert.match(styles, /\.client-workspace-tabs/);
  assert.match(styles, /\.client-workspace-tab-icon\.appointments/);
});

test("keeps the client barber selection and resilient profile photos", async () => {
  const [bookingHome, styles, appointmentApi] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /function ProfileAvatar/);
  assert.match(bookingHome, /referrerPolicy="no-referrer"/);
  assert.match(bookingHome, /onError=\{\(\) => setFailedPhotoUrl/);
  assert.match(bookingHome, /const sourceSize = Math\.min\(image\.naturalWidth, image\.naturalHeight\)/);
  assert.match(bookingHome, /className="client-barber-picker booking-scroll-target"/);
  assert.match(bookingHome, /<span>1<\/span> Barber/);
  assert.match(bookingHome, /const selectBookingBarber = \(barberId: string/);
  assert.match(bookingHome, /appointments\.filter\(\(appointment\) => appointment\.barberId === activeBarberId\)/);
  assert.match(bookingHome, /barberId: activeBarberId/);
  assert.match(appointmentApi, /barberIds\/\$\{proposed\.barberId\}/);
  assert.match(bookingHome, /client-selected-barber-summary/);
  assert.match(bookingHome, /appointment-barber-row/);
  assert.match(styles, /\.profile-avatar\s*\{/);
  assert.match(styles, /\.client-barber-list\s*\{/);
  assert.match(styles, /\.client-barber-avatar\s*\{/);
  assert.match(styles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
});
