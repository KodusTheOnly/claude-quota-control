const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

// core.js is a plain browser script, so load it in a sandbox with the few globals it touches.
function loadCore() {
  const sandbox = {
    document: { getElementById: () => ({}) },
    window: {},
    I18N: { t: (k) => k, getLang: () => "en" },
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, "..", "renderer", "js", "core.js"), "utf8");
  // const/let declarations stay private to the script; expose the functions under test
  vm.runInContext(`${code}\nthis.exports = { weightedDays, dayBudget, perNormalDay, nextReset, upsertSession, projectWeek, levelFromRatio, levelFromSession, levelFromLockout, lockShown, weekLockout, paceReaches, slowDownPct, weekLevel, sameReading, expectedUsed, isOverBudget, isDayOff, offDayNumber };`, sandbox);
  return sandbox.exports;
}

const core = loadCore();
const EVEN = [1, 1, 1, 1, 1, 1, 1];
const day = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const DAY_MS = 86400000;

// Wednesday 2026-10-28
const START = day(2026, 10, 28);

test("weightedDays counts whole days at their weight", () => {
  assert.equal(core.weightedDays(START, day(2026, 11, 4), EVEN), 7);
  // Wed Thu Fri Sat Sun Mon Tue -> 1 + 1 + 1 + 0 + 0 + 2 + 0.5
  const plan = [0, 2, 0.5, 1, 1, 1, 0];
  assert.equal(core.weightedDays(START, day(2026, 11, 4), plan), 1 + 1 + 1 + 0 + 0 + 2 + 0.5);
});

test("an Off day has a budget of 0 and is recognised as off; other days are not", () => {
  const plan = [0, 1, 1, 1, 1, 1, 0]; // Sun and Sat off
  const sat = day(2026, 11, 7, 15);
  const fri = day(2026, 11, 6, 15);
  assert.equal(core.dayBudget(60, day(2026, 11, 11, 8), sat, plan), 0);
  assert.ok(core.dayBudget(60, day(2026, 11, 11, 8), fri, plan) > 0);
  assert.equal(core.isDayOff(sat, plan), true);
  assert.equal(core.isDayOff(fri, plan), false);
  assert.equal(core.isDayOff(sat, [0.5, 1, 1, 1, 1, 1, 0.5]), false); // light is not off
});

test("weightedDays counts a partial day as a fraction", () => {
  assert.equal(core.weightedDays(day(2026, 10, 28, 12), day(2026, 10, 29), EVEN), 0.5);
});

test("an even week splits what is left equally", () => {
  const resetsAt = day(2026, 11, 4);
  assert.ok(Math.abs(core.dayBudget(70, resetsAt, START, EVEN) - 10) < 1e-9);
});

test("the worked example from the weekly plan note", () => {
  // 80% left, four days to go with weights Normal, Heavy, Light, Off (sum 3.5).
  // Each morning the split restarts from what really remains, so spending each day's budget
  // in full reproduces the numbers in the note.
  const plan = [0, 0, 0, 1, 2, 0.5, 0]; // Wed 1, Thu 2, Fri 0.5, Sat 0
  const resetsAt = day(2026, 11, 1);
  let left = 80;
  const budgets = [28, 29, 30, 31].map((d) => {
    const b = core.dayBudget(left, resetsAt, day(2026, 10, d), plan);
    left -= b;
    return b;
  });
  assert.ok(Math.abs(budgets[0] - 22.857) < 0.01);
  assert.ok(Math.abs(budgets[1] - 45.714) < 0.01);
  assert.ok(Math.abs(budgets[2] - 11.428) < 0.01);
  assert.equal(budgets[3], 0);
  assert.ok(Math.abs(left) < 1e-9, "the week is spent exactly");
});

test("budget never goes negative and never exceeds what is left", () => {
  const resetsAt = day(2026, 11, 4);
  assert.equal(core.dayBudget(-5, resetsAt, START, EVEN), 0);
  const last = core.dayBudget(12, day(2026, 10, 29), START, EVEN);
  assert.ok(last <= 12 + 1e-9);
});

test("perNormalDay spreads the remainder over the days left", () => {
  assert.ok(Math.abs(core.perNormalDay(70, day(2026, 11, 4), START, EVEN) - 10) < 1e-9);
  assert.equal(core.perNormalDay(-3, day(2026, 11, 4), START, EVEN), 0);
});

test("nextReset rolls a known reset forward by whole weeks", () => {
  const known = day(2026, 10, 12, 8);
  const now = day(2026, 10, 28, 10);
  assert.equal(core.nextReset(known, now), day(2026, 11, 2, 8));
});

test("upsertSession keeps one entry per window and the highest usage", () => {
  const sr = day(2026, 10, 28, 15);
  let list = core.upsertSession([], sr, 10);
  list = core.upsertSession(list, sr + 2 * 60000, 25); // same window, reset time drifts a little
  list = core.upsertSession(list, sr, 18);
  assert.equal(list.length, 1);
  assert.equal(list[0].peak, 25);
  list = core.upsertSession(list, sr + 5 * 3600000, 4);
  assert.equal(list.length, 2);
  assert.deepEqual(core.upsertSession([], null, 10), []);
});

test("the collector and the app compute the same day budget", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-home-"));
  try {
    const resetsAt = Date.now() + 3 * 24 * 3600000;
    const input = { rate_limits: { five_hour: { used_percentage: 10, resets_at: Date.now() + 3600000 }, seven_day: { used_percentage: 40, resets_at: resetsAt } } };
    const script = path.join(__dirname, "..", "collector", "statusline.js");
    const run = spawnSync(process.execPath, [script], { input: JSON.stringify(input), env: { ...process.env, HOME: home, USERPROFILE: home } });
    assert.equal(run.status, 0, String(run.stderr));
    const saved = JSON.parse(fs.readFileSync(path.join(home, ".claude", "claude-quota-control.json"), "utf8"));
    const today = Object.values(saved.days)[0];
    const expected = core.dayBudget(100 - saved.dayStart.used, resetsAt, saved.dayStart.at, EVEN);
    assert.ok(Math.abs(today.budget - Math.round(expected * 100) / 100) < 0.011, `${today.budget} vs ${expected}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// Runs the collector like Claude Code does: one reading per entry in `usedList`, returns the last line printed
function statusLine({ lang, weights, usedList }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-line-"));
  try {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "claude-quota-control-config.json"), JSON.stringify({ lang, weights }));
    const resetsAt = Date.now() + 3 * 24 * 3600000;
    const script = path.join(__dirname, "..", "collector", "statusline.js");
    let out = "";
    for (const used of usedList) {
      const input = { rate_limits: { seven_day: { used_percentage: used, resets_at: resetsAt } } };
      const run = spawnSync(process.execPath, [script], { input: JSON.stringify(input), env: { ...process.env, HOME: home, USERPROFILE: home } });
      assert.equal(run.status, 0, String(run.stderr));
      out = String(run.stdout);
    }
    return out;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
const offToday = EVEN.map((w, i) => (i === new Date().getDay() ? 0 : w));

test("status line on an Off today: the use as a share of the week, or just 'off', in both languages", () => {
  assert.match(statusLine({ lang: "en", weights: offToday, usedList: [40, 45] }), /\| today 5% \(off\)$/);
  assert.match(statusLine({ lang: "pt-BR", weights: offToday, usedList: [40, 45] }), /\| hoje 5% \(folga\)$/);
  assert.match(statusLine({ lang: "en", weights: offToday, usedList: [40, 40] }), /\| today off$/);
  assert.match(statusLine({ lang: "pt-BR", weights: offToday, usedList: [40, 40] }), /\| hoje folga$/);
});

test("status line on a normal day still prints spent/budget", () => {
  assert.match(statusLine({ lang: "en", weights: EVEN, usedList: [40, 45] }), /\| today 5\/\d+%$/);
  assert.match(statusLine({ lang: "pt-BR", weights: EVEN, usedList: [40, 40] }), /\| hoje 0\/\d+%$/);
});

test("the Off today number: the use as a whole percent, or a dash when nothing was used", () => {
  assert.equal(core.offDayNumber(5), "5%");
  assert.equal(core.offDayNumber(5.4), "5%");
  assert.equal(core.offDayNumber(0), "–");
  assert.equal(core.offDayNumber(0.3), "–");
});

test("forecast waits for a day and a half of normal days", () => {
  const reset = day(2026, 11, 3, 8);
  assert.equal(core.projectWeek(10, reset, day(2026, 10, 27, 20), EVEN), null);
  assert.ok(core.projectWeek(10, reset, day(2026, 10, 29, 12), EVEN));
});

test("forecast pace is per weighted day, so days off do not read as slow days", () => {
  const reset = day(2026, 11, 3, 8);
  const now = day(2026, 10, 30, 8); // three days into the week
  const even = core.projectWeek(30, reset, now, EVEN);
  // Same spend, but half of the elapsed days were days off: the pace per working day is higher
  const lopsided = core.projectWeek(30, reset, now, [1, 1, 1, 1, 0, 0, 1]);
  assert.ok(Math.abs(even.rate - 10) < 0.01);
  assert.ok(lopsided.rate > even.rate);
});

test("forecast says when the limit is reached, skipping days off", () => {
  const reset = day(2026, 11, 3, 8);
  const now = day(2026, 10, 29, 8); // Thursday, 2 days in, 60% used: 30% per day
  const p = core.projectWeek(60, reset, now, [1, 1, 1, 1, 1, 1, 0]);
  assert.ok(p.projected > 100);
  // 40% left at 30% per day: 16 h of Thursday, then 16 h of Friday, so Friday 16:00
  const eta = new Date(p.eta);
  assert.equal(eta.getDate(), 30);
  assert.ok(eta.getHours() === 16, String(eta));
});

test("forecast stays inside the week when spending is slow", () => {
  const reset = day(2026, 11, 3, 8);
  const p = core.projectWeek(10, reset, day(2026, 10, 30, 8), EVEN);
  assert.ok(p.projected < 100);
  assert.equal(p.eta, null);
});

test("week and day levels cut at 0.7, 1.0 and 1.4, edges included in the lower level", () => {
  assert.equal(core.levelFromRatio(0), 0);
  assert.equal(core.levelFromRatio(0.7), 0);
  assert.equal(core.levelFromRatio(0.71), 1);
  assert.equal(core.levelFromRatio(1.0), 1);
  assert.equal(core.levelFromRatio(1.01), 2);
  assert.equal(core.levelFromRatio(1.4), 2);
  assert.equal(core.levelFromRatio(1.41), 3);
  assert.equal(core.levelFromRatio(null), null);
  assert.equal(core.levelFromRatio(NaN), null);
});

test("the week is rated on the hours locked out: Free at 0, Moderate up to 5, Tight up to 24, Pause above", () => {
  assert.equal(core.levelFromLockout(0), 0, "no T, or 0 h locked out");
  assert.equal(core.levelFromLockout(0.4), 0, "0.4 h is shown as 0 h");
  assert.equal(core.levelFromLockout(4.6), 1, "4.6 h is shown as 5 h: Moderate");
  assert.equal(core.levelFromLockout(5), 1, "exactly 5 h stays Moderate");
  assert.equal(core.levelFromLockout(5.6), 2, "5.6 h is shown as 6 h: Tight");
  assert.equal(core.levelFromLockout(24), 2, "exactly 24 h stays Tight");
  assert.equal(core.levelFromLockout(24.6), 3, "24.6 h is shown as 25 h: Pause");
  assert.equal(core.levelFromLockout(49), 3);
  assert.equal(core.levelFromLockout(null), null, "no projection");
  assert.equal(core.levelFromLockout(undefined), null);
  assert.equal(core.levelFromLockout(NaN), null);
});

test("hours locked out are shown in whole hours up to 48 h, in whole days above", () => {
  assert.deepEqual({ ...core.lockShown(0) }, { n: 0, unit: "h", hours: 0 });
  assert.deepEqual({ ...core.lockShown(4.6) }, { n: 5, unit: "h", hours: 5 });
  assert.deepEqual({ ...core.lockShown(48.4) }, { n: 48, unit: "h", hours: 48 });
  assert.deepEqual({ ...core.lockShown(49) }, { n: 2, unit: "d", hours: 48 });
  assert.deepEqual({ ...core.lockShown(80) }, { n: 3, unit: "d", hours: 72 });
});

// Week Wed 2026-10-28 08:00 to Wed 2026-11-04 08:00, even plan
const LOCK_RESET = day(2026, 11, 4, 8);
test("T is when the pace reaches 100%, and the hours locked out run from T to the reset", () => {
  const now = day(2026, 10, 31, 8); // 4 days left
  // 10% per day: from 43% it reaches 100% in 5.7 days, after the reset
  assert.deepEqual({ ...core.weekLockout(43, 10, now, LOCK_RESET, EVEN) }, { at: null, hours: 0 }, "no T");
  // 15% per day: 57% to go is 3.8 days, so T is 0.2 days (4.8 h) before the reset
  const lock = core.weekLockout(43, 15, now, LOCK_RESET, EVEN);
  assert.ok(Math.abs(lock.at - (now + 3.8 * DAY_MS)) < 1000, String(lock.at));
  assert.ok(Math.abs(lock.hours - 4.8) < 1e-6, String(lock.hours));
  assert.equal(core.levelFromLockout(lock.hours), 1);
  // A day off has no pace: with Saturday off (now is Saturday 08:00) only 3.33 plan days are left, so no T
  const plan = [1, 1, 1, 1, 1, 1, 0];
  assert.equal(core.weekLockout(43, 15, now, LOCK_RESET, plan).at, null);
  // With Tuesday off instead, T moves a day later and lands past the reset too
  const tue = core.weekLockout(43, 15, now, LOCK_RESET, [1, 1, 1, 1, 1, 1, 1].map((x, i) => (i === 2 ? 0 : x)));
  assert.equal(tue.at, null);
});

test("a week already at 100% has T now", () => {
  const now = day(2026, 11, 2, 8);
  assert.equal(core.paceReaches(100, 100, 10, now, LOCK_RESET, EVEN), now);
  const lock = core.weekLockout(100, 10, now, LOCK_RESET, EVEN);
  assert.equal(lock.at, now);
  assert.equal(lock.hours, 48);
  assert.equal(core.weekLevel(100, lock.hours, 1.2), 3);
});

test("no pace means no T", () => {
  assert.equal(core.paceReaches(100, 40, 0, day(2026, 11, 2, 8), LOCK_RESET, EVEN), null);
});

test("with a projection, the week takes the level of the hours locked out", () => {
  // weekRatio 1.3 would be Tight on the ratio scale; it must not matter here
  assert.equal(core.weekLevel(40, 0, 1.3), 0);
  assert.equal(core.weekLevel(40, 4.6, 0.5), 1);
  assert.equal(core.weekLevel(40, 5, 0.5), 1);
  assert.equal(core.weekLevel(40, 5.6, 0.5), 2);
  assert.equal(core.weekLevel(40, 24, 0.5), 2);
  assert.equal(core.weekLevel(40, 24.6, 0.5), 3);
  assert.equal(core.weekLevel(40, 49, 0.5), 3);
});

test("without a projection yet, the week falls back to used / expected on the ratio scale", () => {
  assert.equal(core.weekLevel(5, null, 0.7), 0);
  assert.equal(core.weekLevel(5, null, 0.72), 1, "0.72 is Moderate on the ratio scale");
  assert.equal(core.weekLevel(5, null, 1.2), 2);
  assert.equal(core.weekLevel(5, null, null), null, "nothing to rate");
});

test("a week at 95% or more is Pause, with or without a projection", () => {
  assert.equal(core.weekLevel(95, 0, 1.0), 3);
  assert.equal(core.weekLevel(99, 0, 0.5), 3);
  assert.equal(core.weekLevel(96, null, 0.5), 3);
  assert.equal(core.weekLevel(94.4, 3, 1.0), 1, "just under the rule, the hours decide");
  assert.equal(core.weekLevel(94.6, 3, 1.0), 3, "94.6 is shown as 95%, so it is Pause");
});

test("the 95% rule stops 5 h before the reset: then the hours locked out decide", () => {
  assert.equal(core.weekLevel(96, 0, 1.0, 5.1), 3, "more than 5 h left: Pause");
  assert.equal(core.weekLevel(96, 0, 1.0, 5), 0, "5 h left and no lockout: Free");
  assert.equal(core.weekLevel(96, 0, 1.0, 0.2), 0, "10 minutes left: Free");
  assert.equal(core.weekLevel(99, 3, 1.0, 4), 1, "a lockout under 5 h is Moderate");
});

test("slow ~N%: how much the pace of the days left has to drop to end at 100%", () => {
  // 40% used, 123% projected: 1 - 60 / 83 = 0.277, so 28%
  assert.equal(core.slowDownPct(40, 123), 28);
  // 60% used, 110% projected: 1 - 40 / 50 = 0.2, so 20%
  assert.equal(core.slowDownPct(60, 110), 20);
  // An exact whole percent is not pushed up by floating point: 1 - 88 / 100 = 0.12
  assert.equal(core.slowDownPct(12, 112), 12);
  assert.equal(core.slowDownPct(40, 100), 0, "already ends at 100%");
  assert.equal(core.slowDownPct(100, 110), 100, "at 100% already: stop");
  assert.equal(core.slowDownPct(40, 40), null, "no pace");
});

test("levels rate the number as shown: a whole percent, or a ratio to two decimals", () => {
  assert.equal(core.levelFromLockout(5.4), 1, "5.4 h is shown as 5 h: Moderate");
  assert.equal(core.levelFromLockout(5.5), 2, "5.5 h is shown as 6 h: Tight");
  assert.equal(core.levelFromSession(50.4), 0, "50.4% is shown as 50%: Free");
  assert.equal(core.levelFromSession(50.6), 1);
  assert.equal(core.levelFromRatio(0.704), 0, "70.4% of the budget is shown as 70%: Free");
  assert.equal(core.levelFromRatio(0.706), 1);
});

// Reset Tue 08:00. Weights Tue 1, Wed 1, Thu 2, Fri 2, Sat 0, Sun 0.5, Mon 1 (index 0 = Sunday).
// The week Tue 2026-11-03 08:00 to Tue 2026-11-10 08:00 holds 16/24 + 1 + 2 + 2 + 0 + 0.5 + 1 + 8/24 = 7.5 weighted days.
const RESET_PLAN = [0.5, 1, 1, 1, 2, 2, 0];
const RESET_START = day(2026, 11, 3, 8);
const RESET_END = day(2026, 11, 10, 8);

test("the reset day's budget counts only the hours after the reset", () => {
  assert.ok(Math.abs(core.weightedDays(RESET_START, RESET_END, RESET_PLAN) - 7.5) < 1e-9);
  const b = core.dayBudget(100, RESET_END, RESET_START, RESET_PLAN);
  assert.ok(Math.abs(b - (100 * (16 / 24)) / 7.5) < 1e-9, String(b));
  assert.equal(Math.round(b * 10) / 10, 8.9);
  // Later on the reset day the share is the same: the day is judged from its start
  assert.ok(Math.abs(core.dayBudget(100, RESET_END, day(2026, 11, 3, 20), RESET_PLAN) - b) < 1e-9);
});

test("a normal mid-week day keeps its full weight", () => {
  // Thursday (weight 2) at 00:00: 2 of the 2 + 2 + 0 + 0.5 + 1 + 8/24 days left
  const left = 2 + 2 + 0 + 0.5 + 1 + 8 / 24;
  const b = core.dayBudget(60, RESET_END, day(2026, 11, 5), RESET_PLAN);
  assert.ok(Math.abs(b - (60 * 2) / left) < 1e-9, String(b));
});

test("the last partial day before the reset gets everything that is left", () => {
  // Tue 2026-11-10 00:00 to 08:00: the only part of the week left
  assert.ok(Math.abs(core.dayBudget(12, RESET_END, day(2026, 11, 10, 2), RESET_PLAN) - 12) < 1e-9);
  // With the day before it, the share follows the 8 hours: Mon 1 vs Tue 8/24
  const mon = core.dayBudget(12, RESET_END, day(2026, 11, 9, 9), RESET_PLAN);
  assert.ok(Math.abs(mon - (12 * 1) / (1 + 8 / 24)) < 1e-9, String(mon));
});

test("the session is rated on % used: 50, 75 and 90", () => {
  assert.deepEqual([0, 50, 51, 75, 76, 90, 91, 100].map(core.levelFromSession), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.equal(core.levelFromSession(undefined), null);
});

test("expected usage follows the weighted days that have passed", () => {
  const reset = day(2026, 11, 4); // week starts Wed 2026-10-28
  assert.equal(core.expectedUsed(reset, day(2026, 10, 28), EVEN), 0);
  assert.ok(Math.abs(core.expectedUsed(reset, day(2026, 10, 28, 12), EVEN) - 100 / 14) < 1e-9);
  assert.ok(Math.abs(core.expectedUsed(reset, day(2026, 11, 4), EVEN) - 100) < 1e-9);
  // Wed 1, Thu 2, Fri 1 ... with a heavy Thursday, the first two days hold more of the plan
  const plan = [1, 1, 1, 1, 2, 1, 1];
  assert.ok(Math.abs(core.expectedUsed(reset, day(2026, 10, 30), plan) - (300 / 8)) < 1e-9);
  // Past the reset it stays at 100
  assert.ok(Math.abs(core.expectedUsed(reset, day(2026, 11, 9), EVEN) - 100) < 1e-9);
});

test("a reading counts as unchanged only when the week and the session both match", () => {
  const manual = { weekly: { used: 40.2 }, fiveHour: { used: 12.4 } };
  assert.equal(core.sameReading(manual, { weekly: { used: 40 }, session: { used: 12 } }), true);
  assert.equal(core.sameReading(manual, { weekly: { used: 40 }, session: { used: 15 } }), false, "the session moved");
  assert.equal(core.sameReading(manual, { weekly: { used: 41 }, session: { used: 12 } }), false, "the week moved");
  assert.equal(core.sameReading(manual, { weekly: { used: 40 }, session: null }), true, "no session in the reading");
  assert.equal(core.sameReading({ weekly: { used: 40 }, fiveHour: null }, { weekly: { used: 40 }, session: { used: 3 } }), false, "a session appeared");
  assert.equal(core.sameReading(null, { weekly: { used: 40 }, session: null }), false, "first reading");
});

test("over budget follows the ratio as shown: 100.4% is shown as 100% and is not over", () => {
  assert.equal(core.isOverBudget(1.004), false);
  assert.equal(core.isOverBudget(1.006), true);
  assert.equal(core.isOverBudget(1), false);
  assert.equal(core.isOverBudget(0.5), false);
});
