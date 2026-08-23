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
  const [page, layout, manifest, serviceWorker, notifications] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/notifications.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /BNB Barbershop \| Rezerwacja wizyty/);
  assert.match(page, /<BookingHome \/>/);
  assert.match(layout, /applicationName:\s*"BNB Barbershop"/);
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest\?v=3"/);
  assert.match(layout, /\/icons\/apple-touch-icon\.png\?v=3/);
  assert.match(manifest, /"name":\s*"BNB Barbershop"/);
  assert.match(manifest, /\/icons\/icon-192\.png\?v=3/);
  assert.match(manifest, /\/icons\/icon-512\.png\?v=3/);
  assert.match(manifest, /maskable-512\.png\?v=3/);
  assert.match(serviceWorker, /bnb-barbershop-v4/);
  assert.match(serviceWorker, /icon:.*\/icons\/icon-192\.png/);
  assert.match(serviceWorker, /badge:.*\/icons\/notification-b-v4\.png/);
  assert.match(notifications, /badge:\s*"\/icons\/notification-b-v4\.png"/);
});

test("keeps the premium client booking flow and safety controls", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /Twoja najbliższa wizyta/);
  assert.match(bookingHome, /className="booking-progress"/);
  assert.match(bookingHome, /Potwierdzam nowy termin/);
  assert.match(bookingHome, /Odwołaj wizytę/);
  assert.match(bookingHome, /if \(direction === -1 && !canShiftToPreviousMonth\) return/);
  assert.match(bookingHome, /event\.key !== "Escape"/);
  assert.doesNotMatch(bookingHome, /silentNewAppointmentToastIdRef/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.client-service-picker \.service-list/);
});

test("keeps the client-focused sign-in experience concise", async () => {
  const [bookingHome, styles, firebaseSource, netlifyConfig, firebaseConfig] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/firebase.ts", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(new URL("../firebase.json", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /Twój następny termin/);
  assert.match(bookingHome, /Rezerwacja w mniej niż minutę/);
  assert.match(bookingHome, /Przypomnienie przed wizytą/);
  assert.match(bookingHome, /className="install-guide-trigger"/);
  assert.match(bookingHome, /Zainstaluj aplikację/);
  assert.match(bookingHome, /Wybierz swój telefon/);
  assert.match(bookingHome, /iPhone lub iPad/);
  assert.match(bookingHome, /Telefon z Androidem/);
  assert.match(bookingHome, /Instrukcja dla Safari/);
  assert.match(bookingHome, /Instrukcja dla Chrome/);
  assert.match(bookingHome, /Naciśnij Udostępnij/);
  assert.match(bookingHome, /Dodaj do ekranu początkowego/);
  assert.match(bookingHome, /Otwórz menu Chrome/);
  assert.match(bookingHome, /function ChromeBrandIcon/);
  assert.doesNotMatch(bookingHome, /Bez podglądu cudzych rezerwacji/);
  assert.doesNotMatch(bookingHome, /Łatwiejsze przesunięcie wizyty/);
  assert.match(bookingHome, /shouldUseRedirectSignIn\(window\.navigator\)/);
  assert.match(bookingHome, /getRedirectResult\(firebaseAuth\)/);
  assert.match(bookingHome, /shouldFallbackToRedirect\(errorCode\)/);
  assert.match(firebaseSource, /window\.location\.hostname === "bnbbarber\.netlify\.app"/);
  assert.match(netlifyConfig, /from = "\/__\/auth\/\*"/);
  assert.match(netlifyConfig, /status = 200/);
  assert.match(firebaseConfig, /https:\/\/bnbbarber\.netlify\.app\/__\/auth\/handler/);
  assert.match(styles, /\.auth-benefits span::before/);
  assert.match(styles, /\.install-guide-backdrop/);
  assert.match(styles, /\.install-platform-option/);
  assert.match(styles, /\.install-guide-step-icon/);
  assert.match(styles, /@keyframes install-sheet-in/);
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

test("keeps the client and admin waitlist workflow visible and actionable", async () => {
  const [bookingHome, styles, appointmentsApi, notificationService, worker] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_notification-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/notification-worker.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /Powiadom mnie o wolnym terminie/);
  assert.match(bookingHome, /Powiadom mnie o terminie/);
  assert.match(bookingHome, /Lista rezerwowa/);
  assert.match(bookingHome, /acceptWaitlistOffer/);
  assert.match(bookingHome, /Notification\.requestPermission\(\)/);
  assert.match(bookingHome, /openWaitlistBooking/);
  assert.match(bookingHome, />Umów</);
  assert.match(appointmentsApi, /"join_waitlist"/);
  assert.match(appointmentsApi, /hasBlockingWaitlistOffer/);
  assert.match(notificationService, /waitlist_slot_open/);
  assert.match(worker, /advanceExpiredWaitlistOffers/);
  assert.match(worker, /offerAvailableWaitlistSlots/);
  assert.match(styles, /\.waitlist-callout/);
  assert.match(styles, /\.admin-waitlist-row/);
  assert.match(styles, /\.admin-waitlist-book/);
  assert.match(styles, /\.waitlist-modal/);
});

test("keeps the persistent client base and manual admin booking workflow", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /type ClientRecord/);
  assert.match(bookingHome, /result\.adminClients/);
  assert.match(bookingHome, /Baza klientów/);
  assert.match(bookingHome, /Dodaj klienta/);
  assert.match(bookingHome, /Zapisz i umów/);
  assert.match(bookingHome, /Poza grafikiem/);
  assert.match(bookingHome, /łączy konto Google/);
  assert.match(bookingHome, /kolejne powiadomienia trafią do jego konta/);
  assert.match(bookingHome, /const handleSaveClientFromDialog = async/);
  assert.match(bookingHome, /const removeClientFromDirectory = async/);
  assert.match(bookingHome, /"delete_admin_client"/);
  assert.match(bookingHome, /"upsert_admin_client"/);
  assert.match(bookingHome, /wszystkie powiązane wizyty zostaną trwale usunięte/);
  assert.match(bookingHome, /Ten termin nakłada się na inną wizytę/);
  assert.match(bookingHome, /runAppointmentOperation\([\s\S]*"upsert_admin_client"[\s\S]*appointment:/);
  assert.match(styles, /\.client-creator-modal/);
  assert.match(styles, /\.manual-booking-grid/);
  assert.match(styles, /\.client-account-link-hint/);
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

  assert.match(bookingHome, /type SessionContext/);
  assert.match(bookingHome, /sessionContext\?\.role === "owner"/);
  assert.match(bookingHome, /sessionContext\?\.role === "barber"/);
  assert.match(bookingHome, /const \[teamMembers, setTeamMembers\] = useState<BarberProfile\[]>\(\[]\)/);
  assert.match(bookingHome, /Czyj panel chcesz otworzyć\?/);
  assert.doesNotMatch(bookingHome, /appointment\.barberId \|\|/);
  assert.match(bookingHome, /barbers\/\$\{activeBarberId\}\/workSettings/);
  assert.match(bookingHome, /barbers\/\$\{activeBarberId\}\/services/);
  assert.match(appointmentApi, /upsertClientIntoDatabase/);
  assert.match(styles, /\.owner-barber-grid/);
  assert.match(styles, /\.selected-barber-context/);
});

test("keeps the scoped barber profile and centered client action", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /const isAdmin = isOwner \|\| isBarber/);
  assert.match(bookingHome, /resolveActiveBarberId/);
  assert.match(bookingHome, /step === "admin"/);
  assert.match(bookingHome, /barbers\/\$\{activeBarberId\}\/profile/);
  assert.match(bookingHome, /adminSection === "profile"/);
  assert.match(bookingHome, /resizeProfilePhoto/);
  assert.match(styles, /\.barber-profile-view/);
  assert.match(styles, /\.add-client-button span::before/);
  assert.match(styles, /translate\(-50%, -50%\)/);
  assert.match(styles, /repeat\(var\(--admin-nav-items, 5\), minmax\(0, 1fr\)\)/);
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

test("merges schedule and clients into a permission-aware nearest appointments workspace", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /type AdminWorkspaceTab = "upcoming" \| "schedule" \| "clients"/);
  assert.match(bookingHome, /useState<AdminWorkspaceTab>\("upcoming"\)/);
  assert.match(bookingHome, /const canAccessAdminWorkspace = canAccessAdminSchedule \|\| canAccessAdminClients/);
  assert.match(
    bookingHome,
    /standaloneAdminSections\.filter\(\(section\) => canAccessAdminSection\(section\)\)/,
  );
  assert.match(bookingHome, /4 najbliższe wizyty/);
  assert.match(
    bookingHome,
    /const nearestAdminAppointments = selectNearestAppointments\(upcomingAdminAppointments, 4\)/,
  );
  assert.match(bookingHome, /getAppointmentEndDateTime\(appointment\)\.getTime\(\) > currentDate\.getTime\(\)/);
  assert.match(bookingHome, /formatNearestAppointmentLabel\(\{/);
  assert.match(bookingHome, /<strong>\{nearestAppointmentLabel\}<\/strong>/);
  assert.match(bookingHome, /canAccessAdminSchedule && settlementAvailable/);
  assert.match(bookingHome, /canAccessAdminClients && client/);
  assert.match(
    bookingHome,
    /className="cancel"[\s\S]*declineAdminAppointment\(appointment\.id\)[\s\S]*Odwołaj/,
  );
  assert.match(styles, /\.admin-workspace-tabs/);
  assert.match(styles, /\.nearest-appointment-card\.primary/);
  assert.match(styles, /\.nearest-appointment-actions/);
  assert.match(styles, /\.nearest-appointment-actions button\.cancel/);
});

test("moves the complete client directory into the shared appointments workspace", async () => {
  const [bookingHome, styles, appointmentApi] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(
    bookingHome,
    /type AdminSection = Exclude<BarberAdminSection, "clients" \| "services"> \| "team"/,
  );
  assert.match(bookingHome, /<span>Klienci<\/span>/);
  assert.match(bookingHome, /className="client-search"/);
  assert.match(bookingHome, /className="client-filters"/);
  assert.match(bookingHome, /Aktywne wizyty/);
  assert.match(bookingHome, /Historia wizyt/);
  assert.match(bookingHome, /Dodaj klienta/);
  assert.match(bookingHome, /canAccessAdminSchedule \? \([\s\S]*openManualClientBooking/);
  assert.match(bookingHome, /href=\{`tel:\+48\$\{phoneDigits\}`\}/);
  assert.match(bookingHome, /href=\{`sms:\+48\$\{phoneDigits\}`\}/);
  assert.match(bookingHome, /Usuń klienta/);
  assert.match(bookingHome, /isVisibleInClientDatabase/);
  assert.match(appointmentApi, /"delete_admin_client"/);
  assert.match(appointmentApi, /if \(!canAdminAccess\(admin, "schedule"\)\)[\s\S]*Brak uprawnień do umawiania wizyt/);
  assert.match(styles, /\.client-phone-button/);
  assert.match(styles, /\.phone-icon/);
  assert.match(bookingHome, /<Phone className="phone-icon"/);
  assert.match(bookingHome, /<MessageSquare className="sms-icon"/);
  assert.match(bookingHome, /<Mail className="email-icon"/);
  assert.match(bookingHome, /<Calendar className="small-calendar-icon"/);
  assert.match(bookingHome, /<Clock className="workspace-tab-icon upcoming"/);
  assert.doesNotMatch(styles, /\.phone-icon::/);
  assert.doesNotMatch(styles, /\.workspace-tab-icon\.upcoming::/);
  assert.doesNotMatch(styles, /\.clients-icon/);
});

test("moves the complete appointment workflow into the calendar", async () => {
  const [bookingHome, styles, appointmentApi, dataModel] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
    readFile(new URL("../shared/data-model.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /Dodaj wizytę/);
  assert.match(bookingHome, /const renderCalendarAppointmentActions/);
  assert.match(bookingHome, /Potwierdź/);
  assert.match(bookingHome, /Rozlicz/);
  assert.match(bookingHome, /Nieobecność/);
  assert.match(bookingHome, /"create_admin"/);
  assert.match(appointmentApi, /"mark_no_show_admin"/);
  assert.match(appointmentApi, /next\.status = "no_show"/);
  assert.match(dataModel, /"no_show"/);
  assert.match(styles, /\.schedule-add-appointment/);
  assert.match(styles, /\.calendar-client-picker/);
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
  assert.match(bookingHome, /adminNavigationIcons/);
  assert.match(bookingHome, /NavigationIcon/);
  assert.match(styles, /repeat\(var\(--admin-nav-items, 5\), minmax\(0, 1fr\)\)/);
});

test("merges days and services into one permission-aware work workspace", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /type WorkWorkspaceTab = "days" \| "services"/);
  assert.match(bookingHome, /useState<WorkWorkspaceTab>\("days"\)/);
  assert.match(bookingHome, /const canAccessAdminWorkWorkspace = canAccessAdminWork \|\| canAccessAdminServices/);
  assert.match(bookingHome, /const renderWorkWorkspaceTabs = \(\) =>/);
  assert.match(bookingHome, /aria-label="Widok dni pracy i usług"/);
  assert.match(bookingHome, /<span>Dni<\/span>/);
  assert.match(bookingHome, /<span>Usługi<\/span>/);
  assert.match(bookingHome, /Dni dostępne dla klientów/);
  assert.match(bookingHome, /Usługi w aplikacji/);
  assert.doesNotMatch(bookingHome, /adminSection === "services"/);
  assert.doesNotMatch(bookingHome, /setAdminSection\("services"\)/);
  assert.match(styles, /\.work-workspace-panel\.active/);
});

test("keeps the fixed owner-managed team and role-aware admin avatars", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /type BarberAdminSection =[\s\S]*\| "clients"[\s\S]*type AdminSection = Exclude/);
  assert.match(bookingHome, /const teamPath = isOwner \? "team\/barbers"/);
  assert.match(bookingHome, /const updateTeamMemberActive = async/);
  assert.match(bookingHome, /const updateTeamMemberAccess = async/);
  assert.match(bookingHome, /className="team-management-view"/);
  assert.match(bookingHome, /className="client-appointment-modal team-member-dialog"/);
  assert.match(
    bookingHome,
    /photoUrl=\{isBarber \? signedInBarberProfile\.photoUrl : activeUser\.photoURL\}/,
  );
  assert.match(bookingHome, /barber\.id === signedInBarberId/);
  assert.match(bookingHome, /const signedInBarberName =/);
  assert.match(bookingHome, /openOwnerBarberPanel\(member\.id, "schedule"\)/);
  assert.match(bookingHome, /openOwnerBarberPanel\(member\.id, "analytics"\)/);
  assert.match(bookingHome, /setSessionContext\(result\.context as SessionContext\)/);
  assert.match(bookingHome, /sessionContext\?\.role === "barber"/);
  assert.doesNotMatch(bookingHome, /fixedBarberUserIds|ownerUserIds/);
  assert.doesNotMatch(bookingHome, /Dodaj barbera/);
  assert.doesNotMatch(bookingHome, /createTeamInvitation/);
  assert.doesNotMatch(bookingHome, /Identyfikator użytkownika Firebase/);
  assert.match(styles, /\.team-member-card/);
  assert.match(styles, /\.team-access-grid/);
  assert.match(styles, /--admin-nav-items/);
});

test("keeps barber ownership and excludes the owner from appointment notifications", async () => {
  const [bookingHome, notifications, notificationService, appointmentApi, adminHelper] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_notification-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_firebase-admin.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /type Service = \{[\s\S]*barberId: string/);
  assert.match(bookingHome, /type Appointment = \{[\s\S]*barberId: string/);
  assert.match(bookingHome, /type AvailabilityWindow = \{[\s\S]*barberId: string/);
  assert.match(bookingHome, /servicesToRecord = \(items: Service\[\], barberId/);
  assert.doesNotMatch(bookingHome, /migrationUpdates/);
  assert.doesNotMatch(bookingHome, /shouldRunDataMigration/);
  assert.match(appointmentApi, /next\.settlement = \{[\s\S]*amount/);
  assert.match(notifications, /barberId: string/);
  assert.match(notificationService, /process\.env\.BARBER_MATEUSZ_EMAIL/);
  assert.match(notificationService, /process\.env\.BARBER_KACPER_EMAIL/);
  assert.doesNotMatch(notificationService, /process\.env\.ADMIN_EMAIL/);
  assert.match(notificationService, /String\(member\?\.userId \|\| ""\)/);
  assert.match(adminHelper, /readDatabase\("team", accessToken\)/);
  assert.match(notificationService, /if \(copy\.target === "barber" && barber\.active/);
  assert.match(notificationService, /target: "barber"/);
  assert.match(notificationService, /audiences\.delete\(ownerUid\)/);
  assert.doesNotMatch(bookingHome, /inAppNotifications/);
  assert.doesNotMatch(notificationService, /writeInAppNotifications/);
  assert.doesNotMatch(bookingHome, /notificationButton/);
  assert.match(
    appointmentApi,
    /notificationOperationIds\.map[\s\S]*processNotificationJob\(operationId/,
  );
});

test("opens system push links and lets the client confirm a changed time", async () => {
  const [bookingHome, styles, notificationService, appointmentApi, serviceWorker] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_notification-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /url\.searchParams\.get\("appointment"\)/);
  assert.match(bookingHome, /setClientAppointmentId\(appointment\.id\)/);
  assert.match(bookingHome, /confirmsAsAdmin \? "confirm_admin" : "confirm_client"/);
  assert.match(bookingHome, /Czy nowy termin Ci odpowiada\?/);
  assert.match(bookingHome, /Potwierdzam nowy termin/);
  assert.doesNotMatch(styles, /\.notification-bell/);
  assert.doesNotMatch(styles, /\.notification-toast/);
  assert.match(bookingHome, /setAdminEditAppointmentId\(appointment\.id\)/);
  assert.match(notificationService, /link\.searchParams\.set\("appointment"/);
  assert.match(notificationService, /appointmentId: appointment\.id,[\s\S]*event,/);
  assert.match(serviceWorker, /navigate\(targetUrl\)[\s\S]*navigatedClient\?\.focus\(\)/);
  assert.match(appointmentApi, /next\.confirmedBy = action === "confirm_client" \? "client" : "admin"/);
});

test("shows a per-device push toggle and keeps silent token renewal", async () => {
  const [bookingHome, notifications, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /Notification\.permission !== "granted"/);
  assert.match(bookingHome, /registerPushNotifications\(/);
  assert.match(bookingHome, /listenForForegroundPushNotifications\(/);
  assert.match(bookingHome, /className=\{`push-toggle-button/);
  assert.match(bookingHome, /aria-pressed=\{pushDeviceEnabled\}/);
  assert.match(bookingHome, /<Bell size=\{18\}/);
  assert.match(bookingHome, /!isOwner \? \(/);
  assert.match(bookingHome, /disablePushNotifications\(notificationUser\)/);
  assert.match(bookingHome, /isPushNotificationsLocallyDisabled\(activeUser\.uid\)/);
  assert.doesNotMatch(bookingHome, /registerAfterInteraction/);
  assert.match(notifications, /active: false/);
  assert.match(notifications, /deleteToken\(getMessaging\(firebaseApp\)\)/);
  assert.match(styles, /\.push-toggle-button\.enabled/);
  assert.match(styles, /\.push-toggle-button\.disabled/);
  assert.match(styles, /\.session-actions/);
  assert.match(styles, /\.session-actions\s*\{[\s\S]*?width:\s*fit-content;[\s\S]*?max-width:\s*100%/);
  assert.match(styles, /\.session-pill\s*\{[\s\S]*?flex:\s*0 1 auto[\s\S]*?min-width:\s*0/);
  assert.match(styles, /\.session-pill\s*\{[\s\S]*?min-height:\s*2\.65rem/);
  assert.match(
    styles,
    /\.push-toggle-button\s*\{[\s\S]*?width:\s*2\.65rem;[\s\S]*?height:\s*2\.65rem/,
  );
  assert.match(styles, /\.session-pill\s*\{\s*min-height:\s*3\.15rem/);
  assert.match(
    styles,
    /\.push-toggle-button\s*\{\s*width:\s*3\.15rem;\s*height:\s*3\.15rem/,
  );
});

test("keeps barber calendars scoped and client directory counters current", async () => {
  const [bookingHome, appointmentClient, appointmentApi, adminHelper] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/appointments.ts", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_firebase-admin.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(appointmentClient, /adminAppointments\?: T\[\]/);
  assert.match(appointmentApi, /appointment\.barberId === admin\.barberId/);
  assert.match(adminHelper, /owner\.userId === user\.uid/);
  assert.match(bookingHome, /result\.adminAppointments \?\? result\.clientAppointments/);
  assert.match(bookingHome, /!isOwner && sessionContext\.role !== "barber"/);
  assert.match(bookingHome, /listenForForegroundPushNotifications\(\(\) => \{[\s\S]*refreshClientAppointmentData\(\)/);
  assert.match(bookingHome, /new BroadcastChannel\("bnb-appointment-sync"\)/);
  assert.match(
    bookingHome,
    /Klienci\s*<small>\{directoryAdminClientProfiles\.length\}<\/small>/,
  );
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
  assert.match(styles, /\.client-workspace-tab-icon/);
  assert.match(bookingHome, /<Calendar[\s\S]*className="client-workspace-tab-icon appointments"/);
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
  assert.match(appointmentApi, /upsertClientIntoDatabase/);
  assert.match(bookingHome, /client-selected-barber-summary/);
  assert.match(bookingHome, /appointment-barber-row/);
  assert.match(styles, /\.profile-avatar\s*\{/);
  assert.match(styles, /\.client-barber-list\s*\{/);
  assert.match(styles, /\.client-barber-avatar\s*\{/);
  assert.match(styles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
});

test("keeps manual booking services bound to the selected barber", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /isServiceCatalogReady\(\{/);
  assert.match(bookingHome, /setLoadedServicesBarberId\(activeBarberId\)/);
  assert.match(bookingHome, /disabled=\{!serviceCatalogReady \|\| services\.length === 0\}/);
  assert.match(bookingHome, /Ładowanie usług\.\.\./);
  assert.match(bookingHome, /Brak aktywnych usług/);
  assert.match(
    bookingHome,
    /!serviceCatalogReady \|\| !manualBookingService \|\| manualBookingHasConflict/,
  );
  assert.doesNotMatch(
    bookingHome,
    /const openOwnerBarberPanel[\s\S]*?\) => \{\s*setBarberServices\(\[\]\)/,
  );
  assert.match(styles, /\.manual-booking-status\.loading/);
  assert.match(styles, /\.manual-booking-status\.unavailable/);
});
