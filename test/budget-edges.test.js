// The edges of the budget math: the week turning over, the clock changing (this file runs in a time zone that has
// daylight saving time), active hours around the reset, days off, the reserve, 0% and 100%.
process.env.TZ = "America/New_York"; // 2026: clocks go forward on Sun Mar 8 and back on Sun Nov 1

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
  sandbox.__settings = settings;
  vm.runInContext("state.settings = __settings;", sandbox);
  return sandbox;
}
const ev = (sb, expr) => JSON.parse(JSON.stringify(vm.runInContext(expr, sb) ?? null));
const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const near = (a, b, msg = "", eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} vs ${b}`);
const EVEN = [1, 1, 1, 1, 1, 1, 1];
const J = JSON.stringify;

// The collector's own copy of the math, taken from its source
function collector() {
  const src = fs.readFileSync(path.join(__dirname, "..", "collector", "statusline.js"), "utf8");
  const fn = (name) => src.match(new RegExp("function " + name + "\\([\\s\\S]*?\\r?\\n}\\r?\\n"))[0];
  const sb = { Date };
  vm.createContext(sb);
  vm.runInContext(`const DAY_MS = 86400000; const GOAL = 100;\n${["activeSpans", "weightedDays", "dayBudget", "goalOf", "reserveWindow", "reserveHeld", "planBudget"].map(fn).join("")}`, sb);
  return sb;
}

test("this file really runs where the clock changes", () => {
  assert.equal((at(2026, 3, 9) - at(2026, 3, 8)) / 3600000, 23);
  assert.equal((at(2026, 11, 2) - at(2026, 11, 1)) / 3600000, 25);
});

test("a day of 23 or 25 hours still weighs its whole weight", () => {
  const sb = load(at(2026, 3, 8, 12));
  near(ev(sb, `weightedDays(${at(2026, 3, 8)}, ${at(2026, 3, 9)}, ${J(EVEN)})`), 1, "the short day");
  near(ev(sb, `weightedDays(${at(2026, 11, 1)}, ${at(2026, 11, 2)}, ${J(EVEN)})`), 1, "the long day");
  near(ev(sb, `weightedDays(${at(2026, 3, 8)}, ${at(2026, 3, 8, 12)}, ${J(EVEN)})`), 11 / 23, "half of it by the clock");
  const c = collector();
  near(ev(c, `weightedDays(${at(2026, 3, 8)}, ${at(2026, 3, 9)}, ${J(EVEN)})`), 1, "the collector agrees");
  near(ev(c, `weightedDays(${at(2026, 11, 1)}, ${at(2026, 11, 2)}, ${J(EVEN)})`), 1, "the collector agrees");
});

test("in the week the clock changes, an even plan still gives every whole day the same budget", () => {
  // Thu Mar 5 00:00 to Thu Mar 12 01:00 by the clock (a week is 168 hours, and Sunday has 23)
  const reset = at(2026, 3, 5) + 7 * 86400000;
  assert.equal(new Date(reset).getHours(), 1);
  const sb = load(at(2026, 3, 5));
  near(ev(sb, `dayShare(${at(2026, 3, 7, 10)}, ${reset}, ${J(EVEN)})`), 1, "Saturday");
  near(ev(sb, `dayShare(${at(2026, 3, 8, 10)}, ${reset}, ${J(EVEN)})`), 1, "the 23-hour Sunday");
  // From Saturday: five whole days and the first hour of Thursday
  near(ev(sb, `dayBudget(70, ${reset}, ${at(2026, 3, 7, 10)}, ${J(EVEN)})`), 70 / (5 + 1 / 24));
  near(ev(sb, `dayBudget(70, ${reset}, ${at(2026, 3, 8, 10)}, ${J(EVEN)})`), 70 / (4 + 1 / 24));
});

// Spend every day's budget in full, from the reset to the next one
function spendWeek(settings, reset) {
  const sb = load(reset - 7 * 86400000, settings);
  return ev(sb, `(() => {
    const g = goalSettings();
    const w = weights();
    let used = 0;
    const budgets = [];
    for (let t = ${reset} - WEEK; t < ${reset}; ) {
      const b = planBudget(used, ${reset}, t, g, w);
      budgets.push(b);
      used += b;
      const d = new Date(t);
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    }
    return { used, budgets };
  })()`);
}

test("spending each day's budget in full ends the week exactly at the limit, whatever the plan", () => {
  const plans = [EVEN, [0, 1, 1, 1, 1, 1, 0], [2, 0.5, 1, 0, 1, 2, 0.5]];
  const windows = [null, { start: 9, end: 1 }, { start: 9, end: 18 }, { start: 22, end: 6 }];
  const reserves = [{ reserve: 0 }, { reserve: 10, reserveRelease: 48 }, { reserve: 20, reserveRelease: 24 }];
  // Resets in a plain week and in the two weeks the clock changes, early, mid-day and late
  const resets = [at(2026, 6, 9, 8), at(2026, 6, 9, 0, 30), at(2026, 6, 9, 23), at(2026, 3, 10, 15), at(2026, 11, 3, 15), at(2026, 3, 8, 3, 30), at(2026, 11, 1, 1, 30)];
  for (const weights of plans) for (const activeHours of windows) for (const res of reserves) for (const reset of resets) {
    const { used, budgets } = spendWeek({ weights, activeHours, ...res }, reset);
    const where = J({ weights, activeHours, res, reset: new Date(reset).toString() });
    for (const b of budgets) assert.ok(Number.isFinite(b) && b >= 0, `a budget of ${b}: ${where}`);
    near(used, 100, where);
  }
});

test("a budget is never negative, never more than what is left, and 0 only on a day with no plan", () => {
  const reset = at(2026, 6, 9, 8);
  const sb = load(reset - 3 * 86400000);
  for (const usedStart of [0, 0.4, 50, 99.6, 100]) {
    for (let h = 0; h < 7 * 24; h += 5) {
      const now = reset - 7 * 86400000 + h * 3600000;
      const b = ev(sb, `planBudget(${usedStart}, ${reset}, ${now}, FULL_WEEK, ${J(EVEN)})`);
      assert.ok(b >= 0 && b <= 100 - usedStart + 1e-9, `budget ${b} at ${usedStart}% used, hour ${h}`);
      if (usedStart < 100) assert.ok(b > 0, `no budget on a planned day: hour ${h}, ${usedStart}% used`);
    }
  }
});

test("the week turns over: a reading older than the reset counts as a new week at 0%", () => {
  const oldReset = at(2026, 6, 9, 8);
  const now = at(2026, 6, 10, 14); // the day after the reset, with no reading since
  const data = { updatedAt: at(2026, 6, 8, 20), weekly: { used: 83, resetsAt: oldReset }, fiveHour: { used: 40, resetsAt: at(2026, 6, 8, 23), at: at(2026, 6, 8, 20) }, dayStart: { day: "2026-06-08", at: at(2026, 6, 8), used: 70 }, days: { "2026-06-08": { spent: 13, budget: 15, endUsed: 83 } } };
  const sb = load(now, { manual: data });
  sb.__src = { kind: "manual", data };
  const m = ev(sb, "(() => { const m = compute(__src); return { rolled: m.rolled, used: m.w.used, resetsAt: m.w.resetsAt, budget: m.budget, spent: m.spent, ratio: m.todayRatio, five: m.five, today: m.week.findIndex((d) => d.isToday) }; })()");
  assert.equal(m.rolled, oldReset);
  assert.equal(m.used, 0);
  assert.equal(m.resetsAt, oldReset + 7 * 86400000);
  assert.equal(m.spent, 0);
  assert.equal(m.ratio, 0);
  assert.equal(m.five, null);
  assert.equal(m.today, 1);
  near(m.budget, 100 / (6 + 8 / 24), "a share of the whole new week, counted from the start of today");
});

test("nextReset on the reset itself, long after it, and with an anchor far ahead", () => {
  const sb = load(0);
  const anchor = at(2026, 6, 9, 8);
  const W = 7 * 86400000;
  assert.equal(ev(sb, `nextReset(${anchor}, ${anchor})`), anchor + W, "at the reset the next one is a week away");
  assert.equal(ev(sb, `nextReset(${anchor}, ${anchor - 1})`), anchor);
  assert.equal(ev(sb, `nextReset(${anchor}, ${anchor + 10 * W + 5})`), anchor + 11 * W);
  assert.equal(ev(sb, `nextReset(${anchor + 3 * W}, ${anchor - 1})`), anchor, "an anchor weeks ahead comes back to the next one");
  assert.equal(ev(sb, `nextReset(null, ${anchor})`), null);
});

// The reset falls after the end of the active hours: until midnight there is no plan time today
test("the hours after a late reset, outside the active hours, are not rated instead of reading Pause", () => {
  const reset = at(2026, 6, 16, 23, 30);
  const now = at(2026, 6, 9, 23, 45);
  const settings = { activeHours: { start: 9, end: 18 }, weights: EVEN };
  const data = { updatedAt: now, weekly: { used: 1, resetsAt: reset }, fiveHour: null, dayStart: { day: "2026-06-09", at: at(2026, 6, 9, 23, 30), used: 0 }, days: { "2026-06-09": { spent: 1, budget: 0, endUsed: 1 } } };
  const sb = load(now, { ...settings, manual: data });
  sb.__src = { kind: "manual", data };
  assert.equal(ev(sb, `dayIdle(${now}, ${reset})`), true);
  const m = ev(sb, "(() => { const m = compute(__src); const d = m.week.find((x) => x.isToday); return { budget: m.budget, off: m.dayOff, idle: m.idle, ratio: m.todayRatio, lv: m.lv.today, kind: d.kind, level: d.level, dayIdle: d.idle }; })()");
  assert.equal(m.budget, 0);
  assert.equal(m.idle, true);
  assert.equal(m.off, true);
  assert.equal(m.ratio, 0);
  assert.equal(m.lv, null, "no level, where it used to read Pause");
  assert.equal(m.kind, "off");
  assert.equal(m.level, null);
  assert.equal(m.dayIdle, true);
  // The next morning is a plain day again, and so is the same evening without active hours
  assert.equal(ev(sb, `dayIdle(${at(2026, 6, 10, 10)}, ${reset})`), false);
  assert.equal(ev(load(now, { weights: EVEN }), `dayIdle(${now}, ${reset})`), false);
  // An Off day is Off, not idle; and the last hours before a reset are not idle either (they get everything left)
  assert.equal(ev(sb, `dayIdle(${now}, ${reset}, ${J([1, 1, 0, 1, 1, 1, 1])})`), false);
  assert.equal(ev(sb, `dayIdle(${at(2026, 6, 16, 20)}, ${reset})`), false);
});

test("the collector's budget with a reserve is the app's", () => {
  const c = collector();
  const reset = at(2026, 6, 9, 8);
  for (const config of [{ reserve: 10, reserveRelease: 48 }, { reserve: 20, reserveRelease: 24 }, { reserve: 15, reserveRelease: 0 }, { reserve: 5 }, { reserve: 0 }, {}]) {
    for (const activeHours of [null, { start: 9, end: 18 }, { start: 22, end: 6 }]) {
      for (const weights of [EVEN, [0, 1, 1, 1, 1, 1, 0], [2, 0.5, 1, 0, 1, 2, 0.5]]) {
        const sb = load(reset - 86400000, { ...config, activeHours, weights });
        for (const usedStart of [0, 30, 85, 93, 100]) {
          for (let h = 1; h < 7 * 24; h += 7) {
            const now = reset - 7 * 86400000 + h * 3600000;
            const app = ev(sb, `planBudget(${usedStart}, ${reset}, ${now}, goalSettings(), weights())`);
            const col = ev(c, `planBudget(${usedStart}, ${reset}, ${now}, goalOf(${J(config)}), ${J(weights)}, ${J(activeHours)})`);
            near(col, app, J({ config, activeHours, weights, usedStart, h }));
          }
        }
      }
    }
  }
  assert.deepEqual(ev(c, `goalOf({ reserve: 99, reserveRelease: 7 })`), { goal: 100, reserve: 20, release: 48 }, "kept in range, as in the app");
});

test("0% and 100% used give plain numbers everywhere, at any point of the week", () => {
  const reset = at(2026, 6, 9, 8);
  for (const used of [0, 100]) {
    for (const hours of [0.1, 20, 40, 100, 167.9]) {
      const now = Math.round(reset - 7 * 86400000 + hours * 3600000);
      const d = new Date(now);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const data = { updatedAt: now, weekly: { used, resetsAt: reset }, fiveHour: { used, resetsAt: now + 3600000, at: now }, dayStart: { day, at: now, used }, days: { [day]: { spent: 0, budget: 10, endUsed: used } } };
      for (const settings of [{}, { reserve: 10, reserveRelease: 48 }, { activeHours: { start: 9, end: 18 } }, { weights: [0, 0, 0, 0, 0, 0, 0] }]) {
        const sb = load(now, { ...settings, manual: data });
        sb.__src = { kind: "manual", data };
        const m = ev(sb, "(() => { const m = compute(__src); const s = paceSeries(m); return { nums: [m.budget, m.spent, m.todayRatio, m.perDay, m.lv.expected, m.ceiling, m.planToday, ...m.week.map((d) => d.budget ?? 0), ...s.expected.map((p) => p.y), ...s.used.map((p) => p.y)].map((x) => Number.isFinite(x)), kind: m.forecast.kind, level: m.head.level, budget: m.budget }; })()");
        const where = `${used}% used, hour ${hours}, ${J(settings)}`;
        assert.ok(m.nums.every(Boolean), `a number that is not a number: ${where}`);
        assert.ok(m.budget >= 0, where);
        if (used === 100) {
          assert.equal(m.kind, "out", where);
          assert.equal(m.budget, 0, where);
        }
      }
    }
  }
});

test("a reset time that cannot be real is no reset, and one far ahead is brought back to this week", () => {
  const now = at(2026, 6, 10, 14);
  const sb = load(now);
  for (const bad of ["1e300", "-1e300", "Infinity", "NaN", "0", "-5", "8.64e15", "'2026'", "null", "undefined"]) {
    assert.equal(ev(sb, `nextReset(${bad}, ${now})`), null, bad);
  }
  // The same weekday and time, thousands of weeks ahead: one step, not a walk
  const far = at(2026, 6, 16, 8) + 5000 * 7 * 86400000;
  assert.equal(ev(sb, `nextReset(${far}, ${now})`), at(2026, 6, 16, 8));

  // A saved reading whose reset is years ahead still draws, as the week it belongs to
  const data = { updatedAt: now, weekly: { used: 30, resetsAt: far }, fiveHour: null, dayStart: { day: "2026-06-10", at: at(2026, 6, 10), used: 25 }, days: {} };
  const sb2 = load(now, { manual: data });
  sb2.__src = { kind: "manual", data };
  const started = Date.now();
  const m = ev(sb2, "(() => { const m = compute(__src); paceSeries(m); return { resetsAt: m.w.resetsAt, budget: m.budget, rolled: m.rolled }; })()");
  assert.ok(Date.now() - started < 2000, "no walk through the years");
  assert.equal(m.resetsAt, at(2026, 6, 16, 8));
  assert.equal(m.rolled, false);
  assert.ok(m.budget > 0 && m.budget < 75);

  // And a reading with no usable reset is not a reading: the app asks for one instead of drawing nonsense
  for (const resetsAt of [1e300, null, "soon", -1]) {
    const sb3 = load(now, { manual: { ...data, weekly: { used: 30, resetsAt } } });
    assert.equal(ev(sb3, "pickSource()"), null, String(resetsAt));
  }
  const sb4 = load(now, { manual: { ...data, weekly: { used: "30", resetsAt: at(2026, 6, 16, 8) } } });
  assert.equal(ev(sb4, "pickSource()"), null, "a % that is not a number");
});

test("the reserve is never lost on days off: a release that falls on a weekend Off joins Friday", () => {
  // Reset Monday 00:00, Saturday and Sunday Off, release over the last 48 h: all of it on the weekend
  const reset = at(2026, 6, 15);
  const settings = { weights: [0, 1, 1, 1, 1, 1, 0], reserve: 10, reserveRelease: 48 };
  const sb = load(at(2026, 6, 12, 9), settings);
  const win = ev(sb, `reserveWindow(${reset}, goalSettings())`);
  assert.equal(win.from, at(2026, 6, 12), "the release moves to Friday");
  const fri = ev(sb, `planBudget(50, ${reset}, ${at(2026, 6, 12, 9)}, goalSettings())`);
  near(fri, 40 + 10, "Friday, the last planned day: what is left of the plan and the whole reserve");
  // With a reset at 08:00 Monday's first 8 hours are planned and inside the release, so they take it instead
  assert.equal(ev(sb, `reserveWindow(${at(2026, 6, 15, 8)}, goalSettings())`).from, at(2026, 6, 13, 8));
  const { used } = spendWeek(settings, reset);
  near(used, 100);
});

test("the release follows the plan: a heavy day in it gets more of the reserve than a light one", () => {
  const reset = at(2026, 6, 15, 0); // Monday 00:00; the release is Saturday and Sunday
  const sb = load(at(2026, 6, 13, 1), { weights: [0.5, 1, 1, 1, 1, 1, 2], reserve: 12, reserveRelease: 48 });
  const sat = ev(sb, `reserveHeld(${at(2026, 6, 13)}, ${reset}, goalSettings()) - reserveHeld(${at(2026, 6, 14)}, ${reset}, goalSettings())`);
  const sun = ev(sb, `reserveHeld(${at(2026, 6, 14)}, ${reset}, goalSettings())`);
  near(sat, 12 * (2 / 2.5), "Saturday (Heavy)");
  near(sun, 12 * (0.5 / 2.5), "Sunday (Light)");
});
