const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Claude can give part of the week back without a reset (a promotion that clears some of the week's use).
// The week's % then goes down while the reset stays where it was. Today's use counts from the lower number,
// and the chart's used line falls straight down where it happened instead of sliding to it.

function load(nowMs, settings = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [nowMs])); }
    static now() { return nowMs; }
  }
  const sandbox = {
    Date: FakeDate,
    document: { getElementById: () => ({}) },
    window: { quota: { setSettings: async (patch) => ({ ...sandbox.state.settings, ...patch }) } },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "hourly.js", "learn.js", "compute.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext(`state.settings = ${JSON.stringify(settings)}; logReading = async () => {}; render = () => {}; this.state = state;`, sandbox);
  return sandbox;
}
const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const plain = (v) => JSON.parse(JSON.stringify(v));

// Week: Wed 2026-10-28 08:00 to Wed 2026-11-04 08:00. Friday starts at 28%, rises to 40%, Claude gives 20 points
// back at 16:00 (40 -> 20), then 3 more are used: 23% at 19:00. Today used 15 points in all.
const RESET = at(2026, 11, 4, 8);
const READINGS = [
  { at: at(2026, 10, 29, 22), w: 28 },
  { at: at(2026, 10, 30, 14), w: 40 },
  { at: at(2026, 10, 30, 16), w: 20 },
  { at: at(2026, 10, 30, 19), w: 23 },
];
function friday(dayStartUsed = 28) {
  return {
    updatedAt: at(2026, 10, 30, 19),
    weekly: { used: 23, resetsAt: RESET },
    fiveHour: null,
    dayStart: { day: "2026-10-30", at: at(2026, 10, 30), used: dayStartUsed },
    days: {
      "2026-10-28": { spent: 20, budget: 14.3, endUsed: 20 },
      "2026-10-29": { spent: 8, budget: 14.3, endUsed: 28 },
      "2026-10-30": { spent: 15, budget: 14.3, endUsed: 23 },
    },
  };
}
function run(now, data, expr) {
  const sb = load(now, { manual: data, readings: READINGS });
  sb.__src = { kind: "manual", data };
  vm.runInContext("var __m = compute(__src);", sb);
  return plain(vm.runInContext(expr, sb));
}

test("a give-back moves the start of today down, so today is judged from the lower number", () => {
  // Saved before the fix: the day still starts at 28, above the 23 used now
  const m = run(at(2026, 10, 30, 20), friday(28), "({ usedStart: __m.usedStart, budget: __m.budget, spent: __m.spent, ratio: __m.todayRatio, plain: planBudget(8, __m.w.resetsAt, __m.now, __m.g) })");
  assert.equal(m.usedStart, 8); // 23 now, 15 of it used today
  assert.ok(Math.abs(m.budget - m.plain) < 1e-9);
  assert.equal(m.spent, 15);
  assert.ok(m.ratio < 1, `today is within its budget after the give-back (${m.ratio})`);
});

test("without a give-back the start of today is what was saved", () => {
  const data = friday(28);
  data.weekly.used = 43;
  data.days["2026-10-30"] = { spent: 15, budget: 14.3, endUsed: 43 };
  const sb = load(at(2026, 10, 30, 20), { manual: data });
  sb.__src = { kind: "manual", data };
  assert.equal(vm.runInContext("compute(__src).usedStart", sb), 28);
});

test("the used line falls straight down where the give-back happened", () => {
  const s = run(at(2026, 10, 30, 20), friday(8), "paceSeries(__m)");
  const x16 = 2 + 16 / 24;
  const fall = s.used.findIndex((p, i) => i > 0 && Math.abs(p.x - x16) < 1e-9 && Math.abs(s.used[i - 1].x - x16) < 1e-9);
  assert.ok(fall > 0, "two points at 16:00, one above the other");
  assert.equal(s.used[fall - 1].y, 40);
  assert.equal(s.used[fall].y, 20);
  const last = s.used[s.used.length - 1];
  assert.ok(Math.abs(last.x - s.nowX) < 1e-9);
  assert.equal(last.y, 23);
  // Nothing of today is drawn over its budget: after the give-back it is well inside it
  assert.ok(s.over.every((piece) => piece.every((p) => p.x <= 2 + 1e-9)), JSON.stringify(s.over));
});

test("the next day the line goes on from the lower number", () => {
  const data = friday(8);
  data.updatedAt = at(2026, 10, 31, 12);
  data.weekly.used = 25;
  data.dayStart = { day: "2026-10-31", at: at(2026, 10, 31, 11), used: 23 };
  data.days["2026-10-31"] = { spent: 2, budget: 15, endUsed: 25 };
  const s = run(at(2026, 10, 31, 12), data, "paceSeries(__m)");
  const atMidnight = s.used.filter((p) => Math.abs(p.x - 3) < 1e-9).map((p) => p.y);
  assert.ok(atMidnight.length && atMidnight.every((y) => y === 23), JSON.stringify(atMidnight));
  assert.ok(s.used.every((p) => p.x < 2 || p.x > 3 || p.y <= 40));
});

test("saveManual moves the start of the day down by what was given back", async () => {
  const now = at(2026, 10, 30, 16);
  const s = load(now, {
    manual: {
      anchor: RESET,
      updatedAt: at(2026, 10, 30, 14),
      via: "sync",
      weekly: { used: 40, resetsAt: RESET },
      fiveHour: null,
      dayStart: { day: "2026-10-30", at: at(2026, 10, 30, 9), used: 28 },
      days: { "2026-10-30": { spent: 12, budget: 14.3, endUsed: 40 } },
    },
  });
  await s.saveManual({ weekly: 20, via: "sync" });
  const m = plain(s.state.settings.manual);
  assert.equal(m.dayStart.used, 8);
  assert.equal(m.days["2026-10-30"].spent, 12);
  assert.equal(m.days["2026-10-30"].endUsed, 20);
  const expect = vm.runInContext(`round2(planBudget(8, ${RESET}, ${now}, goalSettings()))`, s);
  assert.equal(m.days["2026-10-30"].budget, expect);
  // A plain rise afterwards keeps it
  await s.saveManual({ weekly: 23, via: "sync" });
  assert.equal(s.state.settings.manual.dayStart.used, 8);
  assert.equal(s.state.settings.manual.days["2026-10-30"].spent, 15);
});

test("the drops come from the readings log, and a one point wobble is not one", () => {
  const sb = load(at(2026, 10, 30, 20));
  const drops = plain(vm.runInContext(`weekDrops(${JSON.stringify([...READINGS, { at: at(2026, 10, 30, 19, 30), w: 22.6 }])}, ${RESET - 7 * 864e5}, ${at(2026, 10, 30, 20)})`, sb));
  assert.deepEqual(drops, [{ at: at(2026, 10, 30, 16), from: 40, to: 20 }]);
});

test("the projection's pace counts what was given back, and the end walks on from what is used now", () => {
  const now = at(2026, 10, 30, 20);
  const m = run(now, friday(8), "({ given: __m.given, proj: __m.proj })");
  assert.equal(m.given, 20);
  const sb = load(now);
  const gross = plain(vm.runInContext(`learnedProjection(43, ${RESET}, ${now}, weights(), null)`, sb));
  assert.ok(Math.abs(m.proj.rate - gross.rate) < 1e-9, "the pace of the 43 points really used");
  assert.ok(Math.abs(m.proj.own - gross.own) < 1e-9);
  assert.ok(Math.abs(m.proj.projected - (23 + gross.rate * gross.left)) < 1e-9);
  assert.ok(m.proj.low >= 23);
});

test("after a give-back the expected line starts again from the drop and still ends at the goal", () => {
  const now = at(2026, 10, 30, 20);
  const m = run(now, friday(8), `({ exp: __m.lv.expected, plain: expectedUsed(${RESET}, ${now}, weights(), __m.g),
    atDrop: expectedUsed(${RESET}, ${at(2026, 10, 30, 16)}, weights(), __m.g), s: paceSeries(__m) })`);
  // From 20 at the drop, the rest of the plan scaled to the 80 points left
  const want = 20 + ((m.plain - m.atDrop) * 80) / (100 - m.atDrop);
  assert.ok(Math.abs(m.exp - want) < 1e-9, `${m.exp} vs ${want}`);
  assert.ok(m.exp < m.plain);
  const x16 = 2 + 16 / 24;
  const i = m.s.expected.findIndex((p, k) => k > 0 && Math.abs(p.x - x16) < 1e-9 && Math.abs(m.s.expected[k - 1].x - x16) < 1e-9);
  assert.ok(i > 0, "the line falls straight down at 16:00");
  assert.ok(Math.abs(m.s.expected[i - 1].y - m.atDrop) < 1e-6);
  assert.equal(m.s.expected[i].y, 20);
  assert.equal(m.s.expected[m.s.expected.length - 1].y, 100);
});

test("without a give-back the expected line is the plan's", () => {
  const data = friday(28);
  data.weekly.used = 43;
  data.days["2026-10-30"] = { spent: 15, budget: 14.3, endUsed: 43 };
  const now = at(2026, 10, 30, 20);
  const sb = load(now, { manual: data });
  sb.__src = { kind: "manual", data };
  const r = plain(vm.runInContext(`(() => { const m = compute(__src); return [m.lv.expected, expectedUsed(${RESET}, ${now}, weights(), m.g)]; })()`, sb));
  assert.equal(r[0], r[1]);
});

test("the hours locked out only count the active hours", () => {
  const sb = load(at(2026, 10, 30, 20), { activeHours: { start: 9, end: 22 } });
  const between = vm.runInContext("activeHoursBetween", sb);
  // Limit Monday 21:23, reset Tuesday 07:59: only 37 minutes of the active hours are lost
  const h = between(at(2026, 11, 2, 21) + 23 * 60000, at(2026, 11, 3, 7) + 59 * 60000);
  assert.ok(Math.abs(h - 37 / 60) < 1e-9, String(h));
  const all = load(at(2026, 10, 30, 20));
  assert.ok(Math.abs(vm.runInContext("activeHoursBetween", all)(at(2026, 11, 2, 21), at(2026, 11, 3, 7)) - 10) < 1e-9, "without active hours every hour counts");
});
