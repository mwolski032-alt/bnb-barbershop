import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the production pure TypeScript modules without a browser or test-only copy.
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(new URL(`../app/lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  new Function("exports", "require", outputText)(exports, path => load(path.replace("./", "")));
  modules.set(name, exports);
  return exports;
}
const { buildAnalytics } = load("analytics");
const { defaultWorkSettings, getAppointmentPriceValue, getAppointmentRevenue } = load("booking-selectors");
const visit = (id, extra = {}) => ({ id, clientId: id, userId: id, clientName: id, dateKey: "2026-09-02", startTime: "10:00", durationMinutes: 30, serviceName: "Strzyżenie", price: "60 zł", priceAmount: 60, status: "completed", ...extra });

test("extracted analytics preserves discounts, free visits and settlement amounts", () => {
  const result = buildAnalytics([
    visit("discount", { priceAmount: 55, settlement: { amount: 55 } }),
    visit("free", { priceAmount: 0, settlement: { amount: 0 } }),
    visit("settled", { priceAmount: 60, settlement: { amount: 20 } }),
    visit("previous", { dateKey: "2026-08-02", settlement: { amount: 20 } }),
    visit("cancelled", { status: "cancelled" }),
    visit("future", { status: "confirmed", dateKey: "2026-09-20", priceAmount: 35 }),
  ], "month", new Date(2026, 8, 7, 12), defaultWorkSettings);
  assert.equal(result.revenue, 75);
  assert.equal(result.visits, 3);
  assert.equal(result.averageTicket, 25);
  assert.equal(result.revenueChange, 275);
  assert.equal(result.plannedRevenue, 35);
  assert.equal(result.trend.reduce((sum, bucket) => sum + bucket.revenue, 0), 75);
});

test("zero price never falls back to catalog price and historical text prices remain supported", () => {
  assert.equal(getAppointmentPriceValue(visit("zero", { priceAmount: 0 })), 0);
  assert.equal(getAppointmentRevenue(visit("zero", { settlement: { amount: 0 } })), 0);
  assert.equal(getAppointmentPriceValue({ price: "55 zł" }), 55);
});
