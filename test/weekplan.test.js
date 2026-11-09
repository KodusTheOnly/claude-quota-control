const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// core.js and compute.js are plain browser scripts that share one scope, so load both in a sandbox.
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
    I18N: { t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k), getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "compute.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext(`state.settings = ${JSON.stringify(settings)};`, sandbox);
  return sandbox;
}
const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();

// Week: Wed 2026-10-28 08:00 to Wed 2026-11-04 08:00. Now: Fri 10-30 20:00, so Wed and Thu are past, Fri is today.
function week(settings = {}) {
  const now = at(2026, 10, 30, 20);
  const src = {
    kind: "manual",
    data: {
      updatedAt: now,
      weekly: { used: 40, resetsAt: at(2026, 11, 4, 8) },
      fiveHour: null,
      dayStart: { day: "2026-10-30", at: at(2026, 10, 30), used: 35 },
      days: {
        "2026-10-28": { spent: 15, budget: 14, endUsed: 15 },
        "2026-10-29": { spent: 20, budget: 14, endUsed: 35 },
        "2026-10-30": { spent: 5, budget: 10, endUsed: 40 },
      },
    },
  };
  const sb = load(now, { manual: src.data, ...settings }); // the recorded days are read from the saved manual reading
  return JSON.parse(vm.runInContext(`JSON.stringify(compute(${JSON.stringify(src)}).week)`, sb)); // plain objects, not from the sandbox
}

test("the plan starts on the weekday of the weekly reset", () => {
  const w = week();
  assert.equal(w.length, 7);
  assert.equal(w[0].dow, 3); // Wednesday, the day the reset falls on
  assert.equal(w[0].i, 0);
});

test("each day says whether it is past, today or ahead", () => {
  assert.deepEqual(week().map((d) => d.when), ["past", "past", "today", "future", "future", "future", "future"]);
  assert.deepEqual(week().map((d) => d.isToday), [false, false, true, false, false, false, false]);
});

test("a past day keeps what was recorded, whatever the plan says now", () => {
  const even = week();
  const changed = week({ weights: [1, 1, 1, 0.5, 2, 1, 1] }); // Wednesday (dow 3) is now Light
  assert.equal(even[0].budget, 14);
  assert.equal(changed[0].budget, 14);
  assert.equal(changed[0].spent, even[0].spent);
});

test("a past day set to Off in the plan still counts as past, so it stays locked", () => {
  const thu = week({ weights: [1, 1, 1, 1, 0, 1, 1] })[1]; // Thursday (dow 4) is Off now
  assert.equal(thu.when, "past");
});

test("days ahead split what is left in proportion to their weights", () => {
  const w = week({ weights: [1, 1, 1, 1, 1, 1, 2] }); // Saturday (dow 6) is Heavy
  const sat = w.find((d) => d.dow === 6);
  const sun = w.find((d) => d.dow === 0);
  assert.equal(sat.when, "future");
  assert.ok(sun.budget > 0);
  assert.ok(Math.abs(sat.budget - sun.budget * 2) < 1e-9);
});

test("on the reset day, today and the days ahead split the week by the weighted hours inside it", () => {
  // Reset Tue 08:00, weights Tue 1, Wed 1, Thu 2, Fri 2, Sat 0, Sun 0.5, Mon 1: 7.5 weighted days
  const now = at(2026, 11, 3, 10);
  const src = {
    kind: "manual",
    data: {
      updatedAt: now,
      weekly: { used: 0, resetsAt: at(2026, 11, 10, 8) },
      fiveHour: null,
      dayStart: { day: "2026-11-03", at: at(2026, 11, 3, 8), used: 0 },
      days: { "2026-11-03": { spent: 0, budget: 8.89, endUsed: 0 } },
    },
  };
  const sb = load(now, { manual: src.data, weights: [0.5, 1, 1, 1, 2, 2, 0] });
  const m = JSON.parse(vm.runInContext(`JSON.stringify(compute(${JSON.stringify(src)}))`, sb));
  // The plan aims at the whole week, 100%
  assert.ok(Math.abs(m.budget - (100 * (16 / 24)) / 7.5) < 1e-9, String(m.budget));
  const today = m.week.find((d) => d.isToday);
  const thu = m.week.find((d) => d.dow === 4);
  assert.equal(today.budget, m.budget);
  assert.ok(Math.abs(thu.budget - (100 * 2) / 7.5) < 1e-9, String(thu.budget));
  // The seven cards hold the whole week except the 8 hours of next Tuesday before the reset
  const sum = m.week.reduce((a, d) => a + d.budget, 0);
  assert.ok(Math.abs(sum - (100 - (100 * (8 / 24)) / 7.5)) < 1e-9, String(sum));
});

// What a past day shows on its last line, "used / budget%"
function figures(day) {
  const sb = load(at(2026, 10, 30, 20));
  return JSON.parse(vm.runInContext(`JSON.stringify(pastDayFigures(${JSON.stringify(day)}))`, sb));
}

test("a past day shows what it used against the budget recorded for it", () => {
  const w = week();
  assert.deepEqual(figures(w[0]), { used: 15, budget: 14 });
  assert.deepEqual(figures(w[1]), { used: 20, budget: 14 });
  // 54% of a budget of 17 is 9.18, shown as 9
  assert.deepEqual(figures({ budget: 17, spent: 9.18, ratio: 0.54 }), { used: 9, budget: 17 });
});

test("the use comes from the recorded spend, and from ratio x budget only when the record has none", () => {
  assert.deepEqual(figures({ budget: 17, spent: 4, ratio: 0.54 }), { used: 4, budget: 17 }); // the record wins
  assert.deepEqual(figures({ budget: 17, spent: null, ratio: 0.54 }), { used: 9, budget: 17 });
  assert.deepEqual(figures({ budget: 20, spent: undefined, ratio: 1.5 }), { used: 30, budget: 20 });
});

test("a past day with no budget recorded has only its use", () => {
  assert.deepEqual(figures({ budget: null, spent: 6.4, ratio: null }), { used: 6, budget: null });
  assert.deepEqual(figures({ budget: 0, spent: 3, ratio: 2 }), { used: 3, budget: null });
  assert.deepEqual(figures({ budget: undefined, spent: 0, ratio: null }), { used: 0, budget: null });
});

test("a past day with no reading has no figures", () => {
  assert.equal(figures({ budget: null, spent: null, ratio: null }), null);
  assert.equal(figures({ budget: 17, spent: null, ratio: null }), null);
  // Through the plan: a past day with no record has neither a budget nor a spend
  const sb = load(at(2026, 10, 30, 20), { manual: { days: {} } });
  const src = { kind: "manual", data: { updatedAt: at(2026, 10, 30, 20), weekly: { used: 40, resetsAt: at(2026, 11, 4, 8) }, fiveHour: null, dayStart: { day: "2026-10-30", at: at(2026, 10, 30), used: 35 }, days: {} } };
  const wk = JSON.parse(vm.runInContext(`JSON.stringify(compute(${JSON.stringify(src)}).week.map(pastDayFigures))`, sb));
  assert.deepEqual(wk.slice(0, 2), [null, null]);
});

test("the figures are whole numbers, rounded as on screen", () => {
  assert.deepEqual(figures({ budget: 16.5, spent: 9.5, ratio: 0.5757 }), { used: 10, budget: 17 });
  assert.deepEqual(figures({ budget: 16.49, spent: 9.49, ratio: 0.5755 }), { used: 9, budget: 16 });
  assert.deepEqual(figures({ budget: 14.3, spent: 0.2, ratio: 0.014 }), { used: 0, budget: 14 });
});
