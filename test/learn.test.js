const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// core.js, learn.js and compute.js are plain browser scripts that share one scope, so load them in a sandbox.
function load(nowMs, settings = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [nowMs])); }
    static now() { return nowMs; }
  }
  const sandbox = {
    Date: FakeDate,
    document: { getElementById: () => ({}) },
    window: { quota: {} },
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "learn.js", "compute.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext(`state.settings = ${JSON.stringify(settings)};`, sandbox);
  return sandbox;
}
const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const plain = (v) => JSON.parse(JSON.stringify(v));
const key = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const EVEN = [1, 1, 1, 1, 1, 1, 1];

// This week runs Tue 2026-11-10 08:00 to Tue 11-17 08:00. A past week k (1 = last week) starts k weeks before.
const RESET = at(2026, 11, 17, 8);
// perDow: what each weekday (0 = Sunday) uses, in points of the week. The week's days are Tue, Wed ... Mon.
function pastWeek(days, k, perDow) {
  let end = 0;
  for (let i = 0; i < 7; i++) {
    const ms = at(2026, 11, 10 - 7 * k + i);
    const spent = typeof perDow === "function" ? perDow(new Date(ms).getDay(), k) : perDow[new Date(ms).getDay()];
    end = Math.min(end + spent, 100);
    days[key(ms)] = { spent, budget: 14, endUsed: end };
  }
  return days;
}
function history(n, perDow) {
  const days = {};
  for (let k = 1; k <= n; k++) pastWeek(days, k, perDow);
  return days;
}
function ev(expr, { now = at(2026, 11, 12, 8), days = {}, settings = {} } = {}) {
  const sb = load(now, settings);
  sb.__days = days;
  return plain(vm.runInContext(expr, sb));
}
const near = (a, b, eps = 1e-6, msg = "") => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} vs ${b}`);

// Weekdays 14 points, weekends 2: a week that ends at 74%
const OFFICE = [2, 14, 14, 14, 14, 14, 2];

test("with no past week the projection is the plain pace, and waits a day and a half", () => {
  const early = ev(`learnedProjection(10, ${RESET}, ${at(2026, 11, 11, 8)}, ${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}))`);
  assert.equal(early, null);
  const p = ev(`learnedProjection(20, ${RESET}, ${at(2026, 11, 12, 8)}, ${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}))`);
  near(p.rate, 10);
  near(p.projected, 70);
  assert.equal(p.weeks, 0);
  assert.deepEqual(p.w, EVEN);
  assert.ok(p.low < p.projected && p.high > p.projected);
});

test("a week needs three days with a reading to be learned from", () => {
  const days = { "2026-11-03": { spent: 20, endUsed: 20 }, "2026-11-04": { spent: 15, endUsed: 35 } };
  assert.equal(ev(`learnProfile(__days, ${RESET})`, { days }), null);
  days["2026-11-06"] = { spent: 10, endUsed: 45 };
  const L = ev(`learnProfile(__days, ${RESET})`, { days });
  assert.equal(L.n, 1);
  assert.equal(L.meanEnd, 45);
  // Tue 20, Wed 15, Fri 10
  assert.deepEqual(L.avg, [0, 0, 20, 15, 0, 10, 0]);
});

test("the profile is what each weekday used, averaged over the weeks", () => {
  const L = ev(`learnProfile(__days, ${RESET})`, { days: history(4, OFFICE) });
  assert.equal(L.n, 4);
  assert.deepEqual(L.avg, OFFICE);
  near(L.meanEnd, 74);
});

test("with past weeks the projection answers in the first minute, near where a week usually ends", () => {
  const p = ev(`learnedProjection(0, ${RESET}, ${at(2026, 11, 10, 8) + 60000}, ${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}))`, { days: history(4, OFFICE) });
  assert.equal(p.weeks, 4);
  assert.ok(Math.abs(p.projected - 74) < 1, `projected ${p.projected}`);
  assert.ok(p.low >= 0 && p.low < 74 && p.high > 74);
});

test("a weekday that is always heavy does not read as a spike", () => {
  // Tuesday (the week's first day) takes 40 points, the other days 6: the week ends at 76%
  const days = history(4, [6, 6, 40, 6, 6, 6, 6]);
  const now = at(2026, 11, 11, 0); // the end of that Tuesday, 40% used
  const naive = 40 + (40 / (16 / 24)) * (6 + 8 / 24);
  const p = ev(`learnedProjection(40, ${RESET}, ${now}, ${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}))`, { days });
  assert.ok(naive > 300, "the plain pace would shout");
  assert.ok(p.projected > 65 && p.projected < 95, `projected ${p.projected}`);
});

test("heavy days still to come are counted before they arrive", () => {
  // The same person on a week that starts light: Monday (the last day) takes 40 points
  const days = history(4, [6, 40, 6, 6, 6, 6, 6]);
  const now = at(2026, 11, 14, 8); // four days in, 24% used
  const p = ev(`learnedProjection(24, ${RESET}, ${now}, ${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}))`, { days });
  const plainEnd = 24 + (24 / 4) * 3;
  assert.ok(p.projected > plainEnd + 15, `projected ${p.projected} against the plain ${plainEnd}`);
});

test("a day the plan turns Off stays out of the projection, whatever the past says", () => {
  const plan = [1, 1, 1, 1, 1, 1, 0]; // Saturday off
  // The week's days: Tue (from 08:00), Wed, Thu, Fri, Sat, Sun, Mon, then Tue until 08:00
  const w = ev(`forecastWeights(${JSON.stringify(plan)}, learnProfile(__days, ${RESET}), ${RESET}).slots`, { days: history(4, OFFICE) });
  assert.equal(w[4], 0);
  assert.ok(w[6] > w[5], "Monday weighs more than Sunday");
});

test("the plan counts as one more week, so one odd week does not take over", () => {
  const one = ev(`forecastWeights(${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}), ${RESET}).slots`, { days: history(1, [0, 0, 70, 0, 0, 0, 0]) });
  // The first Tuesday (16 of its 24 hours are in the week): all of the learned week (7 of 7) and its 16 h of the plan, halved
  near(one[0] * (16 / 24), (7 + 16 / 24) / 2);
  near(one[1], 0.5); // Wednesday: nothing learned, 1 of the plan
  near(one[7] * (8 / 24), 8 / 24 / 2); // the last hours before the reset: only the plan knows them
  // The eight days add up to a week of 7
  const whole = ev(`weightedDays(${RESET} - WEEK, ${RESET}, forecastWeights(${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}), ${RESET}))`, { days: history(1, [0, 0, 70, 0, 0, 0, 0]) });
  near(whole, 7);
});

test("what the reset day used counts in its hours after the reset, not spread to the hours before the next one", () => {
  const days = history(4, [6, 6, 40, 6, 6, 6, 6]);
  const f = `forecastWeights(${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}), ${RESET})`;
  const firstDay = ev(`weightedDays(${at(2026, 11, 10, 8)}, ${at(2026, 11, 11)}, ${f})`, { days });
  const lastHours = ev(`weightedDays(${at(2026, 11, 17)}, ${RESET}, ${f})`, { days });
  assert.ok(firstDay > 2.5, `the heavy Tuesday: ${firstDay}`);
  assert.ok(lastHours < 0.1, `the hours before the reset: ${lastHours}`);
});

test("the range narrows as the week goes on", () => {
  const days = history(4, OFFICE);
  const width = (now, used) => {
    const p = ev(`learnedProjection(${used}, ${RESET}, ${now}, ${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}))`, { days });
    return p.high - p.low;
  };
  const start = width(at(2026, 11, 10, 9), 1);
  const mid = width(at(2026, 11, 13, 8), 37);
  const late = width(at(2026, 11, 16, 20), 72);
  assert.ok(start > mid && mid > late, `${start} > ${mid} > ${late}`);
  assert.ok(late < 6, `half a day from the reset the range is a few points: ${late}`);
});

test("weeks that are alike give a narrower range than weeks that are not", () => {
  const now = at(2026, 11, 13, 8);
  const expr = `learnedProjection(37, ${RESET}, ${now}, ${JSON.stringify(EVEN)}, learnProfile(__days, ${RESET}))`;
  const regular = ev(expr, { days: history(6, OFFICE) });
  const wild = ev(expr, { days: history(6, (dow, k) => OFFICE[dow] * (k % 2 ? 0.3 : 1.35)) });
  const none = ev(`learnedProjection(37, ${RESET}, ${now}, ${JSON.stringify(EVEN)}, null)`);
  assert.ok(regular.high - regular.low < wild.high - wild.low);
  assert.ok(regular.high - regular.low < none.high - none.low, "and narrower than with no history at all");
});

test("the range never starts under what is already used, and is shown up to 100%", () => {
  const p = ev(`learnedProjection(95, ${RESET}, ${at(2026, 11, 13, 8)}, ${JSON.stringify(EVEN)}, null)`);
  assert.ok(p.low >= 95);
  const shown = ev(`rangeShown({ low: 95.2, high: 140 })`);
  assert.deepEqual(shown, { low: 95, high: 100, text: "95–100%" });
  assert.equal(ev(`rangeShown({ low: 99.6, high: 140 })`).text, "100%");
});

test("a plan is suggested after three weeks, from how the weekdays compare", () => {
  assert.equal(ev(`suggestWeights(learnProfile(__days, ${RESET}))`, { days: history(2, OFFICE) }), null);
  // Sunday never, Saturday a little, Monday double
  const sug = ev(`suggestWeights(learnProfile(__days, ${RESET}))`, { days: history(4, [0, 28, 12, 12, 12, 12, 5]) });
  assert.deepEqual(sug, [0, 2, 1, 1, 1, 1, 0.5]);
  assert.deepEqual(ev(`suggestWeights(learnProfile(__days, ${RESET}))`, { days: history(4, [10, 11, 9, 10, 10, 12, 10]) }), EVEN);
});

test("a weekday used now and then is Light, not Off", () => {
  // Sunday is used in half of the weeks
  const sug = ev(`suggestWeights(learnProfile(__days, ${RESET}))`, { days: history(4, (dow, k) => (dow === 0 ? (k % 2 ? 4 : 0) : 12)) });
  assert.equal(sug[0], 0.5);
});

// The whole thing through compute(): the first hours of a week with history
function firstDay(days, used = 3) {
  const now = at(2026, 11, 10, 14);
  const src = {
    kind: "manual",
    data: { updatedAt: now, weekly: { used, resetsAt: RESET }, fiveHour: null, dayStart: { day: "2026-11-10", at: at(2026, 11, 10, 8), used: 0 }, days: { ...days, "2026-11-10": { spent: used, budget: 14, endUsed: used } } },
  };
  const sb = load(now, { manual: src.data }); // the history is read from the saved data
  sb.__src = src;
  return plain(vm.runInContext("(() => { const m = compute(__src); return { kind: m.forecast.kind, proj: m.lv.proj, level: m.lv.projection, band: paceSeries(m).band, range: m.math.projection.find((r) => r[0] === 'math.range') }; })()", sb));
}

test("compute: on the first day a week with history has a verdict, a range and a fan on the chart", () => {
  const out = firstDay(history(4, OFFICE));
  assert.equal(out.kind, "fits");
  assert.equal(out.level, 0);
  assert.ok(out.proj.projected > 60 && out.proj.projected < 90);
  assert.ok(out.band && out.band.low < out.band.high && out.band.high <= 100);
  assert.match(out.range[1], /^\d+–\d+%$/);
});

test("compute: on the first day a week with no history is still too early to tell", () => {
  const out = firstDay({});
  assert.equal(out.kind, "early");
  assert.equal(out.proj, null);
  assert.equal(out.band, null);
});

// A week whose past weeks hit the limit, early on Tuesday: the projection is mostly those weeks
function heavyStart(used) {
  const now = at(2026, 11, 10, 20);
  const src = { kind: "manual", data: { updatedAt: now, weekly: { used, resetsAt: RESET }, fiveHour: null, dayStart: { day: "2026-11-10", at: at(2026, 11, 10, 8), used: 0 }, days: { ...history(4, [25, 25, 25, 25, 25, 25, 25]), "2026-11-10": { spent: used, budget: 14, endUsed: used } } } };
  const sb = load(now, { manual: src.data });
  sb.__src = src;
  return plain(vm.runInContext("(() => { const m = compute(__src); return { proj: m.lv.projection, today: m.lv.today, week: m.lv.week, head: m.head.level, reason: m.head.reason }; })()", sb));
}

test("compute: early in the week, within today's budget, the verdict is calm", () => {
  const out = heavyStart(1);
  assert.equal(out.today, 0);
  assert.equal(out.head, 0);
});

test("compute: early in the week, over today's budget, the verdict follows today and stops at Tight", () => {
  const out = heavyStart(25);
  assert.equal(out.today, 3);
  assert.equal(out.head, 2);
  assert.equal(out.reason, "reason.todayOver");
  assert.equal(out.week, 2, "the week bar takes the verdict's level");
});

test("the budget does not move when the app learns: only the projection does", () => {
  const run = (days) => {
    const now = at(2026, 11, 12, 14);
    const src = { kind: "manual", data: { updatedAt: now, weekly: { used: 30, resetsAt: RESET }, fiveHour: null, dayStart: { day: "2026-11-12", at: at(2026, 11, 12), used: 25 }, days: { ...days, "2026-11-12": { spent: 5, budget: 14, endUsed: 30 } } } };
    const sb = load(now, { manual: src.data });
    sb.__src = src;
    return plain(vm.runInContext("(() => { const m = compute(__src); return { budget: m.budget, week: m.week.map((d) => d.budget), expected: m.lv.expected }; })()", sb));
  };
  assert.deepEqual(run(history(4, [0, 28, 12, 12, 12, 12, 5])), run({}));
});
