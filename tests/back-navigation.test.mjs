import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBackController } from "../shared/back-navigation.mjs";

// A small model of a browser: a history stack, traversals that complete asynchronously,
// popstate events and timers. `exited` records that Back left the site.
class FakeBrowser {
  entries = [{ state: null }];
  index = 0;
  exited = false;
  traversals = [];
  timers = [];
  clock = 0;
  listeners = [];
  get state() { return this.entries[this.index].state; }
  pushState(state) { this.entries.splice(this.index + 1); this.entries.push({ state }); this.index += 1; }
  replaceState(state) { this.entries[this.index].state = state; }
  goCalls = 0;
  go(delta) {
    this.goCalls += 1;
    this.traversals.push(() => {
      const next = this.index + delta;
      if (next < 0) { this.exited = true; return; }
      if (next >= this.entries.length) return;
      this.index = next;
      this.dispatch(this.state);
    });
  }
  back() { this.go(-1); }
  dispatch(state) { for (const listener of this.listeners) listener({ state }); }
  setTimeout(callback, delay) { this.timers.push({ at: this.clock + delay, callback }); }
  now() { return this.clock; }
  settle(rounds = 20) {
    for (let round = 0; round < rounds; round += 1) {
      while (this.traversals.length) this.traversals.shift()();
      const due = this.timers.filter((timer) => timer.at <= this.clock + 200).sort((a, b) => a.at - b.at);
      if (!due.length && !this.traversals.length) return;
      this.timers = this.timers.filter((timer) => !due.includes(timer));
      this.clock += 200;
      for (const timer of due) timer.callback();
    }
    throw new Error("history never settled");
  }
}

// A tiny app: named screens that can be opened, closed with an X, or closed by Back.
function createApp({ refuse = [] } = {}) {
  const browser = new FakeBrowser();
  const controller = createBackController({ history: browser, setTimeout: (cb, ms) => browser.setTimeout(cb, ms), now: () => browser.now() });
  browser.listeners.push(controller.onPopState);
  const open = {};
  let suspended = false;
  const order = ["modal", "visits", "admin", "login"];
  const render = () => controller.update({
    suspended,
    levels: order.map((name) => ({ active: Boolean(open[name]), close: () => { if (!refuse.includes(name)) open[name] = false; render(); } })),
  });
  const app = {
    browser, open,
    show(name) { open[name] = true; render(); browser.settle(); },
    closeWithButton(name) { open[name] = false; render(); browser.settle(); },
    pressBack() { browser.back(); browser.settle(); },
    suspend(value) { suspended = value; render(); },
    visible: () => order.filter((name) => open[name]),
    render,
  };
  render();
  return app;
}

test("Back closes an open screen, and a second Back leaves the site", () => {
  const app = createApp();
  app.show("visits");
  assert.equal(app.browser.entries.length, 2);
  app.pressBack();
  assert.deepEqual(app.visible(), []);
  assert.equal(app.browser.exited, false);
  app.pressBack();
  assert.equal(app.browser.exited, true);
});

test("a screen closed with its own button leaves no dead Back press behind", () => {
  const app = createApp();
  app.show("visits");
  app.closeWithButton("visits");
  assert.equal(app.browser.index, 0);
  app.pressBack();
  assert.equal(app.browser.exited, true, "one Back at the root must leave");
});

test("nested screens close one at a time, innermost first", () => {
  const app = createApp();
  app.show("admin");
  app.show("modal");
  assert.equal(app.browser.index, 2);
  app.pressBack();
  assert.deepEqual(app.visible(), ["admin"]);
  app.pressBack();
  assert.deepEqual(app.visible(), []);
  app.pressBack();
  assert.equal(app.browser.exited, true);
});

test("closing the inner dialog with its X keeps the outer screen on Back", () => {
  const app = createApp();
  app.show("admin");
  app.show("modal");
  app.closeWithButton("modal");
  assert.deepEqual(app.visible(), ["admin"]);
  app.pressBack();
  assert.deepEqual(app.visible(), []);
  assert.equal(app.browser.exited, false);
  app.pressBack();
  assert.equal(app.browser.exited, true);
});

test("opening and closing repeatedly never grows the history", () => {
  const app = createApp();
  for (let round = 0; round < 6; round += 1) { app.show("visits"); app.closeWithButton("visits"); }
  assert.equal(app.browser.index, 0);
  app.show("visits"); app.show("modal");
  app.closeWithButton("modal"); app.closeWithButton("visits");
  assert.equal(app.browser.index, 0);
  app.pressBack();
  assert.equal(app.browser.exited, true);
});

test("a close that is refused (for example while saving) keeps the screen and its entry", () => {
  const app = createApp({ refuse: ["modal"] });
  app.show("modal");
  app.pressBack();
  assert.deepEqual(app.visible(), ["modal"]);
  assert.equal(app.browser.index, 1, "the entry is restored so Back still works afterwards");
  assert.equal(app.browser.exited, false);
});

test("opening a screen twice quickly before history settles still ends consistent", () => {
  const app = createApp();
  app.open.visits = true; app.render();
  app.open.visits = false; app.render();
  app.open.visits = true; app.render();
  app.browser.settle();
  assert.equal(app.browser.index, 1);
  app.pressBack();
  assert.deepEqual(app.visible(), []);
  assert.equal(app.browser.exited, false);
});

test("login screen to wizard: the wizard keeps its entry and closing it returns cleanly", () => {
  const app = createApp();
  app.show("login");
  assert.equal(app.browser.index, 1);
  // The user signs in: the login screen goes away and the wizard takes over.
  app.open.login = false;
  app.suspend(true);
  app.browser.pushState({ bnbWizard: true });
  app.browser.settle();
  assert.equal(app.browser.index, 2);
  // Wizard closed with its X: it removes its own entry.
  app.suspend(false);
  app.browser.back();
  app.browser.settle();
  assert.equal(app.browser.exited, false);
  assert.equal(app.browser.index, 0, "the stale login entry is trimmed too");
  app.pressBack();
  assert.equal(app.browser.exited, true);
});

test("Android Back at the first wizard step returns to the salon without leaving the site", () => {
  const app = createApp();
  app.show("login");
  app.open.login = false;
  app.suspend(true);
  app.browser.pushState({ bnbWizard: true });
  app.browser.settle();
  // The system Back pops the wizard entry; the wizard itself closes and the UI resumes.
  app.browser.back();
  app.browser.settle();
  app.suspend(false);
  app.browser.settle();
  assert.equal(app.browser.exited, false);
  assert.equal(app.browser.index, 0);
});

test("the controller stays passive while the wizard is open", () => {
  const app = createApp();
  app.suspend(true);
  const before = app.browser.entries.length;
  app.open.visits = true; app.render();
  app.browser.back(); app.browser.settle();
  assert.equal(app.browser.entries.length, before);
  assert.equal(app.open.visits, true, "the wizard owns Back here");
});

test("an unrelated hash navigation at the root does not make the app leave", () => {
  const app = createApp();
  app.browser.dispatch(null);
  app.browser.settle();
  assert.equal(app.browser.exited, false);
});

test("forward navigation onto a deeper entry is undone", () => {
  const app = createApp();
  app.show("visits");
  app.pressBack();
  app.browser.go(1);
  app.browser.settle();
  assert.deepEqual(app.visible(), []);
  assert.equal(app.browser.index, 0);
});

test("the app wires the controller into the real screens", () => {
  const home = readFileSync(new URL("../app/booking-home.tsx", import.meta.url), "utf8");
  assert.match(home, /useBackNavigation\(\[/);
  const call = home.slice(home.indexOf("useBackNavigation(["), home.indexOf("useBackNavigation([") + 4200);
  for (const screen of ["setSmsComposer(null)", "setClientDialog(null)", "setAdminEditAppointmentId(null)", "setSelectedAdminClientId(null)",
    "setClientAppointmentId(null)", "setClientAppointmentsListOpen(false)", 'visibleStep === "admin"', "setWizardOpen(false)"]) {
    assert.ok(call.includes(screen), screen);
  }
  const wizard = readFileSync(new URL("../app/components/booking-wizard.tsx", import.meta.url), "utf8");
  assert.match(wizard, /getBackController\(\)\.expectPop\(\);\s*window\.history\.back\(\)/);
});

test("dialogs of the salon page and the app's own screens are closed in the right order", () => {
  const browser = new FakeBrowser();
  const controller = createBackController({ history: browser, setTimeout: (cb, ms) => browser.setTimeout(cb, ms), now: () => browser.now() });
  browser.listeners.push(controller.onPopState);
  const open = { profile: false, visits: false };
  const render = () => {
    controller.update({ levels: [{ active: open.profile, close: () => { open.profile = false; render(); } }] }, "salon", 10);
    controller.update({ levels: [{ active: open.visits, close: () => { open.visits = false; render(); } }] }, "app", 0);
  };
  render();
  open.visits = true; render(); browser.settle();
  open.profile = true; render(); browser.settle();
  assert.equal(browser.index, 2);
  browser.back(); browser.settle();
  assert.deepEqual(open, { profile: false, visits: true }, "the profile dialog is more inner, so it closes first");
  browser.back(); browser.settle();
  assert.deepEqual(open, { profile: false, visits: false });
  assert.equal(browser.exited, false);
  browser.back(); browser.settle();
  assert.equal(browser.exited, true);
});

test("a part of the UI that unmounts stops contributing history entries", () => {
  const browser = new FakeBrowser();
  const controller = createBackController({ history: browser, setTimeout: (cb, ms) => browser.setTimeout(cb, ms), now: () => browser.now() });
  browser.listeners.push(controller.onPopState);
  controller.update({ levels: [{ active: true, close: () => {} }] }, "salon", 10);
  browser.settle();
  assert.equal(browser.index, 1);
  controller.remove("salon");
  browser.settle();
  assert.equal(browser.index, 0, "its entry is trimmed again");
});

test("booking from a barber profile closes the dialog first and starts at that barber's services", () => {
  const salon = readFileSync(new URL("../app/components/salon-home.tsx", import.meta.url), "utf8");
  assert.match(salon, /bookAfterClose\.current = profile\.id; close\(\);/);
  assert.match(salon, /if \(barberId\) props\.onBook\(barberId\);/);
  assert.match(salon, /group: "salon", priority: 10/);
  const home = readFileSync(new URL("../app/booking-home.tsx", import.meta.url), "utf8");
  assert.match(home, /onBook=\{\(barberId\) => \{/);
  assert.match(home, /selectBookingBarber\(barberId, false\);\s*setBookingWizardStep\(1\);/);
  // The choice has to survive signing in: it is applied only once the session and the team are ready.
  assert.match(home, /viewMemoryReadyUser !== activeUser\.uid\) return;\s*if \(clientBarberOptions\.length === 0\) return;/);
  assert.match(home, /sessionStorage\.setItem\("bnb-booking-barber", bookingBarberIntent\)/);
  assert.match(home, /sessionStorage\.getItem\("bnb-booking-barber"\)/);
  // One popstate listener for the whole page, owned by the controller, not one per component.
  const hook = readFileSync(new URL("../app/hooks/use-back-navigation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(hook, /addEventListener\("popstate"/);
  assert.match(readFileSync(new URL("../app/lib/back-navigation.ts", import.meta.url), "utf8"), /addEventListener\("popstate"/);
});

test("renders that happen while a history trim is still travelling never issue a second go()", () => {
  const browser = new FakeBrowser();
  const controller = createBackController({ history: browser, setTimeout: (cb, ms) => browser.setTimeout(cb, ms), now: () => browser.now() });
  browser.listeners.push(controller.onPopState);
  const open = (active) => ({ levels: [{ active, close: () => {} }] });
  controller.update(open(true), "app");
  browser.settle();
  assert.equal(browser.index, 1);
  // The screen closes by itself, then the UI re-renders several times before the browser has moved.
  controller.update(open(false), "app");
  controller.update(open(false), "app");
  controller.update(open(false), "app");
  assert.equal(browser.goCalls, 1, "one trim is enough");
  browser.settle();
  assert.equal(browser.exited, false, "two overlapping go(-1) calls used to walk past the first entry");
  assert.equal(browser.index, 0);
});

test("closing a salon dialog while the booking starts (dialog group removed, login screen shown) stays on the page", () => {
  const browser = new FakeBrowser();
  const controller = createBackController({ history: browser, setTimeout: (cb, ms) => browser.setTimeout(cb, ms), now: () => browser.now() });
  browser.listeners.push(controller.onPopState);
  controller.update({ levels: [{ active: true, close: () => {} }] }, "salon", 10);
  controller.update({ levels: [{ active: false, close: () => {} }] }, "app", 0);
  browser.settle();
  assert.equal(browser.index, 1);
  // The profile dialog closes, the salon page unmounts and the login screen appears, in separate renders.
  controller.update({ levels: [{ active: false, close: () => {} }] }, "salon", 10);
  controller.remove("salon");
  let loginOpen = true;
  const loginLevels = () => ({ levels: [{ active: loginOpen, close: () => { loginOpen = false; controller.update(loginLevels(), "app", 0); } }] });
  controller.update(loginLevels(), "app", 0);
  browser.settle();
  assert.equal(browser.exited, false);
  assert.equal(browser.index, 1, "the login screen owns exactly one entry");
  assert.equal(browser.goCalls, 1);
  browser.back(); browser.settle();
  assert.equal(browser.exited, false, "Back closes the login screen first");
  browser.back(); browser.settle();
  assert.equal(browser.exited, true);
});
// --- Framework history guard ---------------------------------------------------------------

import { FRAMEWORK_NAVIGATE, guardHistoryTraversal } from "../shared/history-guard.mjs";

test("history moves never trigger the framework's page reload, other navigations still work", async () => {
  const calls = [];
  const scope = { [FRAMEWORK_NAVIGATE]: async (...args) => { calls.push(args); return "navigated"; } };
  guardHistoryTraversal(scope);
  assert.equal(await scope[FRAMEWORK_NAVIGATE]("/", 0, "traverse"), undefined);
  assert.deepEqual(calls, [], "a traversal must not reach the framework (it would reload the static page)");
  assert.equal(await scope[FRAMEWORK_NAVIGATE]("/next", 0, "navigate", "push"), "navigated");
  assert.deepEqual(calls, [["/next", 0, "navigate", "push"]]);
});

test("the guard also wraps a navigate function that the framework assigns later, and only once", async () => {
  const calls = [];
  const scope = {};
  guardHistoryTraversal(scope);
  scope[FRAMEWORK_NAVIGATE] = async (...args) => { calls.push(args); };
  await scope[FRAMEWORK_NAVIGATE]("/", 0, "traverse");
  assert.equal(calls.length, 0);
  const wrapped = scope[FRAMEWORK_NAVIGATE];
  guardHistoryTraversal(scope);
  assert.equal(scope[FRAMEWORK_NAVIGATE], wrapped, "wrapping twice would stack guards");
  await scope[FRAMEWORK_NAVIGATE]("/x", 0, "navigate");
  assert.equal(calls.length, 1);
});

test("the guard is installed before the controller listens, and the app imports the shared module", () => {
  const source = readFileSync(new URL("../app/lib/back-navigation.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("guardHistoryTraversal(window") < source.indexOf("createBackController({"));
  assert.match(source, /from "\.\.\/\.\.\/shared\/history-guard\.mjs"/);
});
// --- Admin section trail ------------------------------------------------------------------

// The admin area as the app models it: a list of visited sections (one history level each), an owner
// "barber panel" level and the admin screen itself. "Wróć" leaves the whole area at once.
function createAdminApp() {
  const browser = new FakeBrowser();
  const controller = createBackController({ history: browser, setTimeout: (cb, ms) => browser.setTimeout(cb, ms), now: () => browser.now() });
  browser.listeners.push(controller.onPopState);
  const model = { open: false, section: "schedule", trail: [] };
  const render = () => controller.update({ levels: [
    ...model.trail.map(() => ({ active: model.open, close: () => { model.section = model.trail.pop(); render(); } })),
    { active: model.open, close: () => { model.open = false; model.trail = []; render(); } },
  ] });
  return {
    browser, model,
    openPanel() { model.open = true; render(); browser.settle(); },
    goTo(section) { if (section === model.section) return; model.trail.push(model.section); model.section = section; render(); browser.settle(); },
    back() { browser.back(); browser.settle(); },
    pressWroc() { model.open = false; model.trail = []; render(); browser.settle(); },
  };
}

test("Back walks the admin sections in the order they were visited, then the main page", () => {
  const app = createAdminApp();
  app.openPanel();                 // "Mój panel" (Terminy)
  app.goTo("analytics");           // Analiza
  app.goTo("work");                // Praca
  assert.equal(app.browser.index, 3);
  app.back();
  assert.equal(app.model.section, "analytics");
  assert.equal(app.model.open, true);
  app.back();
  assert.equal(app.model.section, "schedule");
  assert.equal(app.model.open, true);
  app.back();
  assert.equal(app.model.open, false, "the last Back closes the panel and shows the main page");
  assert.equal(app.browser.exited, false);
  app.back();
  assert.equal(app.browser.exited, true);
});

test('the "Wróć" button still jumps straight to the main page and leaves no stale entries', () => {
  const app = createAdminApp();
  app.openPanel();
  app.goTo("analytics");
  app.goTo("work");
  app.pressWroc();
  assert.equal(app.model.open, false);
  assert.equal(app.browser.index, 0, "all three entries are trimmed at once");
  assert.equal(app.browser.exited, false);
  app.back();
  assert.equal(app.browser.exited, true, "one Back at the main page leaves, with no dead presses");
});

test("revisiting a section is part of the history too, and switching tabs repeatedly is bounded by the app", () => {
  const app = createAdminApp();
  app.openPanel();
  app.goTo("analytics");
  app.goTo("schedule");
  app.back();
  assert.equal(app.model.section, "analytics");
  app.back();
  assert.equal(app.model.section, "schedule");
  assert.equal(app.model.open, true);
  app.back();
  assert.equal(app.model.open, false);
});

test("the admin trail is wired to the bottom navigation, the owner's barber panel and the Back button", () => {
  const home = readFileSync(new URL("../app/booking-home.tsx", import.meta.url), "utf8");
  assert.match(home, /const goToAdminSection = \(section: AdminSection\) => \{\s*if \(section === adminSection\) return;/);
  assert.match(home, /setAdminBackStack\(\(stack\) => \[\.\.\.stack, adminSection\]\.slice\(-ADMIN_BACK_LIMIT\)\)/);
  assert.match(home, /onClick=\{\(\) => goToAdminSection\(section\)\}/);
  assert.match(home, /\.\.\.adminBackStack\.map\(\(\) => \(\{ active: visibleStep === "admin", close: goBackAdminSection \}\)\)/);
  assert.match(home, /active: Boolean\(isOwner && selectedBarber && visibleStep === "admin"\), close: \(\) => setSelectedBarberId\(null\)/);
  // The trail sits between the dialogs (closed first) and the admin screen itself (closed last).
  const call = home.slice(home.indexOf("useBackNavigation(["));
  assert.ok(call.indexOf("setClientAppointmentsListOpen(false)") < call.indexOf("adminBackStack.map"));
  assert.ok(call.indexOf("adminBackStack.map") < call.indexOf('active: visibleStep === "admin",'));
  // "Wróć" keeps its old behaviour: straight to the salon page, which also clears the trail.
  assert.match(home, /onClick=\{\(\) => withViewTransition\(\(\) => \{\s*setStep\("booking"\);\s*setSalonOpen\(true\);/);
  assert.match(home, /if \(visibleStep !== "admin" \|\| adminBackStackRef\.current\.length > 0\) setAdminBackStack\(\[\]\)/);
});