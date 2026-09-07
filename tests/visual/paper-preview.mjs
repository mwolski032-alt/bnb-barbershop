// Local, read-only visual fixture. No Firebase, authentication or production writes.
// Run after npm run build: node tests/visual/paper-preview.mjs
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const cache = new Map();
function load(file) {
  if (!path.extname(file)) file = [".tsx", ".ts", ".mjs"].map(ext => file + ext).find(p => fs.existsSync(p));
  if (!/\.tsx?$/.test(file)) return require(file);
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } });
  const exports = {};
  new Function("exports", "require", outputText)(exports, name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name)) : require(name));
  cache.set(file, exports);
  return exports;
}
const component = name => load(path.join(root, "app/components/screens", name)).default;
const Settings = component("admin-settings-screen"), Calendar = component("admin-calendar-screen");
const Clients = component("admin-clients-screen"), Analytics = component("admin-analytics-screen");
const { defaultWorkSettings } = load(path.join(root, "app/lib/booking-selectors"));
const h = React.createElement, noop = () => {}, today = new Date(2026, 8, 7, 9, 30);
const appointment = { id: "visual-only", barberId: "mateusz", clientId: "sample", userId: "sample", dateKey: "2026-09-07", startTime: "11:00", durationMinutes: 60, clientName: "Klient testowy", serviceName: "Strzyżenie i pielęgnacja brody", price: "80 zł", priceAmount: 80, color: "blue", status: "confirmed", phone: "" };
const client = { id: "sample", name: "Klient testowy", email: "", phone: "", photoUrl: "", appointments: [appointment], nextAppointment: appointment, lastAppointment: null, rescheduledCount: 0, hiddenFromDirectory: false };
const availability = { id: "2026-09-07", barberId: "mateusz", dateKey: "2026-09-07", startTime: "10:00", endTime: "18:00" };
const tabs = h("div", { className: "admin-workspace-tabs" }, ...["Najbliższe", "Kalendarz", "Klienci"].map((label,i) => h("button", { key: label, className: i === 1 ? "active" : "" }, label)));
const settingsBase = {
  workspaceTabs: tabs, canManageDays: true, canManageServices: true,
  availabilityWindows: [availability], nearestAvailability: availability,
  availabilityDraft: { start: "2026-09-07", end: "2026-09-07", startTime: "10:00", endTime: "18:00" },
  availabilityDraftDays: 1, availabilityDraftDuration: 480, availabilityOverwriteCount: 0,
  canSaveAvailability: true, isWorkSaving: false, feedback: null, today,
  timeOptions: ["09:00", "10:00", "11:00", "12:00", "17:00", "18:00"],
  quickAvailabilityOptions: [], availability: { [availability.id]: availability },
  availabilityMonthGroups: [{ key: "2026-09", label: "Wrzesień 2026", items: [availability], totalMinutes: 480 }],
  expandedAvailabilityMonth: "2026-09", pendingAvailabilityRemovalKey: null,
  services: [{ id: "cut", barberId: "mateusz", name: "Strzyżenie i pielęgnacja brody", price: "80 zł", durationMinutes: 60 }],
  editingService: null, serviceDraft: { name: "", price: "", durationMinutes: "30" }, canSaveService: false,
  isSavingService: false, isActionPending: () => false,
};
const noopProps = { onResetAvailability: noop, onSetAvailabilityPreset: noop, onUpdateAvailability: noop, onSaveAvailability: noop, onQuickAddAvailability: noop, onToggleAvailabilityMonth: noop, onEditAvailability: noop, onRemoveAvailability: noop, onResetService: noop, onUpdateService: noop, onSaveService: noop, onEditService: noop, onDeleteService: noop };
const calendarBase = { workspaceTabs: tabs, selectedDateKey: "2026-09-07", dayAppointments: [appointment], dayAvailability: availability, scheduleDays: ["2026-09-07","2026-09-08","2026-09-09","2026-09-10","2026-09-11","2026-09-12","2026-09-13"], allAppointments: [appointment], availability: { [availability.id]: availability }, scheduleSlots: Array.from({length:32},(_,i)=>`${String(10+Math.floor(i/4)).padStart(2,"0")}:${String(i%4*15).padStart(2,"0")}`), scheduleHours: ["10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"], scheduleStartMinutes: 600, today, currentDate: today, draggedAppointmentId: null, currentTimeLineVisible: false, currentTimeLineTop: 0, currentTimeLineMinutes: 570, isTouchDevice: true, onCreateAppointment: noop, onShiftDay: noop, onSelectDate: noop, onEditAppointment: noop, onOpenWorkEditor: noop, onMoveAppointment: noop, onDragStart: noop, renderAppointmentActions: () => h("div",{className:"appointment-actions"},h("button",{className:"confirm"},"Potwierdź"),h("button",{className:"no-show"},"Nieobecność")) };
const profile = { displayName: "Mateusz", phone: "", email: "", instagram: "bnb.barbershop", bio: "Klasyczne strzyżenie, precyzyjna broda i dbałość o detale.", photoUrl: "" };
const access = Object.fromEntries(["schedule","clients","analytics","work","services","profile"].map(key=>[key,true]));
const member = { id:"mateusz", name:"Mateusz", label:"Barber", accent:"blue", userId:"visual-only", email:"", active:true, access };
const screens = {
  // Client monolith specimens reuse its actual classes without authentication or handlers.
  booking: () => h("section", {className:"booking-view"},
    h("div",{className:"topbar"},h("div",{className:"topbar-title"},h("img",{className:"topbar-logo-mark",src:"/brand/bnb-mark.png",alt:""}),h("div",null,h("p",{className:"eyebrow"},"BNB Barbershop"),h("h1",null,"Twój panel")))),
    h("div",{className:"home-hero"},h("img",{src:"/brand/bnb-hero-960.webp",alt:""})),
    h("h2",null,"Umów wizytę"),
    h("ol",{className:"booking-progress"},...["Barber","Usługa","Dzień","Godzina"].map((label,i)=>h("li",{key:label,className:i===2?"active":"complete"},h("button",null,h("span",null,i+1),label)))),
    h("div",{className:"client-barber-list"},h("button",{className:"client-barber-card selected"},h("strong",null,"Mateusz"),h("i",null,"✓")),h("button",{className:"client-barber-card"},h("strong",null,"Drugi barber"))),
    h("div",{className:"service-list"},h("button",{className:"service-card selected"},h("span",null,h("strong",null,"Strzyżenie"),h("small",null,"60 min")),h("b",null,"80 zł"))),
    h("div",{className:"calendar-grid"},...["high","medium selected today","low","none"].map((state,i)=>h("button",{key:state,className:`day-tile ${state}`,disabled:i===3},h("span",{className:"day-number"},i+7),h("span",{className:"availability-bar"},h("span",{style:{width:"60%"}}))))),
    h("div",{className:"time-list"},h("button",null,"10:00"),h("button",{className:"selected"},"11:00"),h("button",{disabled:true},"12:00")),
    h("button",{className:"confirm-button"},"Potwierdź rezerwację")),
  modal: () => h("div",{className:"client-modal-backdrop cancellation-backdrop"},h("section",{className:"client-appointment-modal client-bottom-sheet cancellation-sheet",role:"alertdialog","aria-modal":true,"aria-label":"Odwołać wizytę?"},h("button",{className:"modal-close-button","aria-label":"Zamknij"},"×"),h("div",{className:"modal-title"},h("p",{className:"eyebrow"},"Potwierdzenie"),h("h2",null,"Odwołać wizytę?")),h("p",{className:"cancellation-copy"},"Strzyżenie, poniedziałek 7 września o 11:00. Tej operacji nie można cofnąć."),h("div",{className:"modal-actions cancellation-actions"},h("button",null,"Wróć"),h("button",{className:"danger"},"Odwołaj wizytę")))),
  success: () => h("section",{className:"success-view"},h("div",{className:"success-topbar"},h("span",null,"BNB Barbershop"),h("button",{className:"calendar-save-button","aria-label":"Dodaj do kalendarza"},h("span",null))),h("div",{className:"success-loader done"},h("span",{className:"loader-ring"}),h("span",{className:"loader-check"})),h("div",{className:"success-summary"},h("h1",null,"Wizyta potwierdzona"))),
  profile: () => h(Settings, { mode:"profile", barberName:"Mateusz", barber:member, draft:profile, feedback:null, isSaving:false, isPhotoProcessing:false, isSaveActionPending:false, onPhotoChange:noop,onChange:noop,onSave:noop }),
  work: () => h(Settings, { mode:"work", workspaceTab:"days", ...settingsBase, ...noopProps }),
  services: () => h(Settings, { mode:"work", workspaceTab:"services", ...settingsBase, ...noopProps }),
  calendar: () => h(Calendar, { mode:"calendar", ...calendarBase }),
  upcoming: () => h(Calendar, { mode:"upcoming", workspaceTabs:tabs, upcomingAppointments:[appointment],nearestAppointments:[appointment],clients:[client],waitlistEntries:[],today,currentDate:today,canManageSchedule:true,canManageClients:true,settlingAppointmentId:null,isWaitlistSaving:false,isActionPending:()=>false,onWorkspaceChange:noop,onSettleAppointment:noop,onEditAppointment:noop,onOpenClient:noop,onOpenSms:noop,onCancelAppointment:noop,onBookWaitlist:noop,onRemoveWaitlist:noop }),
  clients: () => h(Clients, { workspaceTabs:tabs,workspaceTab:"directory",canManageClients:true,canManageSchedule:true,activeClients:[client],directoryClients:[client],filteredClients:[client],feedback:null,search:"",filter:"all",currentDate:today,settlingAppointmentId:null,onCreateClient:noop,onWorkspaceChange:noop,onSearchChange:noop,onFilterChange:noop,onOpenClient:noop,onSettleAppointment:noop,onBookClient:noop,onOpenSms:noop,canSettleAppointment:()=>false,isPotentialNoShow:()=>false,isActionPending:()=>false }),
  analytics: () => h(Analytics, { appointments:[{...appointment,status:"completed",settlement:{amount:55}}],currentDate:today,workSettings:defaultWorkSettings,period:"month",onPeriodChange:noop }),
  team: () => h(Settings, { mode:"team",members:[member],activeMembersCount:1,profiles:{mateusz:profile},feedback:null,editedMemberId:null,isSaving:false,adminSections:Object.keys(access),accessLabels:{schedule:"Terminarz",clients:"Klienci",analytics:"Analiza",work:"Praca",services:"Usługi",profile:"Profil"},onActiveChange:noop,onEditMember:noop,onOpenBarberPanel:noop,onAccessChange:noop }),
};
const assets=path.join(root,"dist/client/assets");
const css=fs.readdirSync(assets).filter(file=>file.endsWith(".css")).map(file=>fs.readFileSync(path.join(assets,file),"utf8")).join("\n");
const documents = Object.fromEntries(Object.entries(screens).map(([key,render]) => [key, `<!doctype html><html lang="pl"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>BNB — ${key} — test wizualny</title><style>${css}</style></head><body><nav aria-label="Podglądy testowe">${Object.keys(screens).map(k=>`<a href="/${k}">${k}</a>`).join(" · ")}</nav><main class="app-shell admin-page"><section class="admin-view"><div class="admin-topbar"><button class="back-button">Wróć</button><h1>Panel barbera</h1><span>BNB</span></div><div class="selected-barber-context"><span class="profile-avatar selected-barber-avatar"><span class="profile-avatar-fallback">M</span></span><span><small>Twój panel</small><strong>Mateusz</strong></span></div><div class="admin-content-frame">${renderToStaticMarkup(render())}</div></section></main></body></html>`]));
http.createServer((request,response)=>{
  const key=new URL(request.url,"http://localhost").pathname.slice(1)||"profile";
  response.writeHead(documents[key]?200:404,{"Content-Type":"text/html; charset=utf-8"});
  response.end(documents[key]||"Not found");
}).listen(4177,"127.0.0.1",()=>console.log("Read-only visual fixtures: http://127.0.0.1:4177/profile"));
