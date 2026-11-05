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
  assert.ok(Math.abs(m.budget - (100 * (16 / 24)) / 7.5) < 1e-9, String(m.budget));
  const today = m.week.find((d) => d.isToday);
  const thu = m.week.find((d) => d.dow === 4);
  assert.equal(today.budget, m.budget);
  assert.ok(Math.abs(thu.budget - (100 * 2) / 7.5) < 1e-9, String(thu.budget));
  // The seven cards hold the whole week except the 8 hours of next Tuesday before the reset
  const sum = m.week.reduce((a, d) => a + d.budget, 0);
  assert.ok(Math.abs(sum - (100 - (100 * (8 / 24)) / 7.5)) < 1e-9, String(sum));
});
