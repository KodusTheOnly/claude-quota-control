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

// Week: Wed 2026-10-28 08:00 to Wed 2026-11-04 08:00, even plan. Now: Fri 10-30 20:00 (2.5 days in).
function reading({ used, session = null, now = at(2026, 10, 30, 20) }) {
  const resetsAt = at(2026, 11, 4, 8);
  return {
    now,
    src: {
      kind: "manual",
      data: {
        updatedAt: now,
        weekly: { used, resetsAt },
        fiveHour: session === null ? null : { used: session, resetsAt: now + 3600000, at: now },
        dayStart: { day: "2026-10-30", at: at(2026, 10, 30), used: used - 5 },
        days: { "2026-10-30": { spent: 5, budget: 10, endUsed: used } },
      },
    },
  };
}
function run(r) {
  const sb = load(r.now);
  return vm.runInContext(`compute(${JSON.stringify(r.src)})`, sb);
}

// 2.5 of 7 plan days passed and 4.5 left, so the pace is used / 2.5 per day and the projection is used * 2.8.
// The pace reaches 100% after 2.5 * (100 - used) / used days; the hours locked out are what is left of the 4.5.
const lockedHours = (used) => 24 * (4.5 - (2.5 * (100 - used)) / used);
// The use that leaves exactly `hours` locked out
const usedFor = (hours) => 100 / (1 + (4.5 - hours / 24) / 2.5);

test("the week is rated on the hours locked out before the reset", () => {
  assert.equal(run(reading({ used: 15 })).lv.projection, 0); // never reaches 100%
  assert.equal(run(reading({ used: 27 })).lv.projection, 0); // projects 75.6%, no T
  assert.equal(run(reading({ used: 36 })).lv.projection, 1); // about 1.3 h locked out
  assert.equal(run(reading({ used: 37 })).lv.projection, 2); // about 5.8 h
  assert.equal(run(reading({ used: 40 })).lv.projection, 2); // 18 h
  assert.equal(run(reading({ used: 45 })).lv.projection, 3); // about 34.7 h
  assert.equal(run(reading({ used: 60 })).lv.projection, 3);
  assert.ok(Math.abs(run(reading({ used: 40 })).lv.lock.hours - lockedHours(40)) < 1e-6);
});

test("hours locked out are rated as shown: 4.6 h is 5 h (Moderate), 5.6 h is 6 h (Tight), 24.6 h is 25 h (Pause)", () => {
  for (const [hours, level] of [[0.3, 0], [4.6, 1], [5, 1], [5.6, 2], [24, 2], [24.6, 3], [49, 3]]) {
    const m = run(reading({ used: usedFor(hours) }));
    assert.ok(Math.abs(m.lv.lock.hours - hours) < 1e-6, `${hours} h: ${m.lv.lock.hours}`);
    assert.equal(m.lv.projection, level, `${hours} h`);
    assert.equal(m.lv.week, level, `${hours} h, week`);
    assert.equal(m.head.level, level, `${hours} h, verdict`);
  }
});

test("the week's math shows hours above 48 in days", () => {
  const m = run(reading({ used: usedFor(49) }));
  assert.equal(m.math.week.find(([k]) => k === "math.hoursLocked")[1], 'dur.lockDays {"n":2}');
  const m2 = run(reading({ used: usedFor(12) }));
  assert.equal(m2.math.week.find(([k]) => k === "math.hoursLocked")[1], 'dur.lockHours {"n":12}');
});

test("a Free answer says how much would be left at the reset, as a plain fact", () => {
  const m = run(reading({ used: 25 })); // projects 70%, 30% under the limit
  assert.equal(m.head.level, 0);
  assert.equal(m.lv.lock.at, null);
  assert.equal(m.lv.slow, null, "no slow down while Free");
  assert.ok(m.head.reason.includes('reason.free.leftAtReset {"pct":"30%"}'), m.head.reason);
});

test("from Moderate up the answer says when the week reaches 100% and how early, and how much to slow down", () => {
  const m = run(reading({ used: 40 })); // projects 112%, 18 h locked out
  assert.equal(m.head.level, 2);
  assert.ok(!m.head.reason.includes("leftAtReset"));
  assert.ok(m.head.reason.includes("reason.weekLocked"), m.head.reason);
  assert.ok(m.head.reason.includes('"dur":"dur.lockHours {\\"n\\":18}"'), m.head.reason);
  // 1 - (100 - 40) / (112 - 40) = 0.1667, rounded up to 17%
  assert.equal(m.lv.slow, 17);
});

test("with no projection there is no T, no hours and no slow down", () => {
  const m = run(reading({ used: 5, now: at(2026, 10, 28, 20) }));
  assert.equal(m.lv.proj, null);
  assert.equal(m.lv.lock, null);
  assert.equal(m.lv.slow, null);
  assert.equal(m.lv.projection, null);
});

test("a week already at 100% has T now and reads Pause", () => {
  const now = at(2026, 11, 2, 8); // 5 days in, 2 days left
  const m = run(reading({ used: 100, now }));
  assert.equal(m.lv.lock.at, now);
  assert.ok(Math.abs(m.lv.lock.hours - 48) < 1e-6);
  assert.equal(m.lv.week, 3);
  assert.equal(m.head.level, 3);
  assert.equal(m.lv.slow, 100);
});

test("without a projection yet, a Free answer does not guess what is left", () => {
  const m = run(reading({ used: 4, now: at(2026, 10, 28, 20) })); // under the expected pace, so Free
  assert.equal(m.head.level, 0);
  assert.ok(!m.head.reason.includes("leftAtReset"));
});

test("while the verdict still reads early (under 1% used), the Free answer does not add what is left", () => {
  const m = run(reading({ used: 0.5 }));
  assert.equal(m.forecast.kind, "early");
  assert.equal(m.lv.projection, 0);
  assert.ok(!m.head.reason.includes("leftAtReset"));
});

test("the week level follows the hours locked out, not used / expected", () => {
  const m = run(reading({ used: 27 })); // used / expected 0.756 (Moderate on the ratio scale), no T
  assert.ok(m.lv.weekRatio > 0.7);
  assert.equal(m.lv.week, 0);
  assert.equal(m.lv.week, m.lv.projection);
  assert.equal(run(reading({ used: 30 })).lv.week, 0); // projects 84%, never reaches 100%
  assert.equal(run(reading({ used: 36 })).lv.week, 1);
  assert.equal(run(reading({ used: 40 })).lv.week, 2);
});

test("before there is a projection, the week uses used / expected", () => {
  const m = run(reading({ used: 6, now: at(2026, 10, 28, 20) })); // half a day in: expected 7.1%, ratio 0.84
  assert.equal(m.lv.projection, null);
  assert.equal(m.lv.week, 1);
  const row = m.math.week.find(([k]) => k === "math.weekScale");
  assert.equal(row[1], "math.weekScaleRatio");
  assert.ok(m.math.week.some(([k]) => k === "math.cutoffsRatio"));
});

test("a week at 95% or more reads Pause in the week level, the verdict and the math", () => {
  const m = run(reading({ used: 96, now: at(2026, 11, 3, 20) })); // late in the week: projects about 100%
  assert.equal(m.lv.week, 3);
  assert.equal(m.head.level, 3);
  assert.ok(m.math.week.some(([k]) => k === "math.weekPause"));
});

test("10 minutes before the reset, a week at 96% is no longer Pause", () => {
  const m = run(reading({ used: 96, now: at(2026, 11, 4, 7) + 50 * 60000 }));
  assert.ok(m.head.level < 3, `level ${m.head.level}`);
  assert.ok(m.lv.week < 3, `week ${m.lv.week}`);
  assert.ok(!m.math.week.some(([k]) => k === "math.weekPause"));
});

test("with a projection, the week's math shows when it hits 100%, the hours locked out and the slow down", () => {
  const m = run(reading({ used: 27 }));
  assert.ok(!m.math.week.some(([k]) => k === "math.weekScale"), "no Scale row");
  assert.equal(m.math.week.find(([k]) => k === "math.hitsLock")[1], "math.notBeforeReset");
  assert.equal(m.math.week.find(([k]) => k === "math.hoursLocked")[1], 'dur.lockHours {"n":0}');
  assert.equal(m.math.week.find(([k]) => k === "math.slowNeeded")[1], "–");
  assert.equal(run(reading({ used: 40 })).math.week.find(([k]) => k === "math.slowNeeded")[1], "~17%");
  assert.ok(m.math.week.some(([k]) => k === "math.cutoffsProjection"));
  assert.ok(!m.math.week.some(([k]) => k === "math.cutoffsRatio"));
  assert.ok(m.math.today.some(([k]) => k === "math.cutoffsRatio"), "Today keeps the ratio scale");
});

test("the math rows show the hours cutoffs", () => {
  const m = run(reading({ used: 25 }));
  const row = m.math.projection.find(([k]) => k === "math.cutoffsProjection");
  assert.ok(row, "a cutoffs row");
  assert.equal(row[1], 'math.cutoffsProjectionValue {"a":"dur.lockHours {\\"n\\":0}","b":"dur.lockHours {\\"n\\":5}","c":"dur.lockHours {\\"n\\":24}"}');
});

test("the answer follows the projection, not the session", () => {
  const m = run(reading({ used: 15, session: 95 }));
  assert.equal(m.lv.session, 3);
  assert.equal(m.head.level, 0);
});

test("a week at 95% or more is always Pause", () => {
  assert.equal(run(reading({ used: 96 })).head.level, 3);
});

test("the module levels and the math rows come out of the same numbers", () => {
  const m = run(reading({ used: 40, session: 42 }));
  assert.equal(m.lv.session, 0);
  // The plan ends at 100%
  assert.ok(Math.abs(m.lv.expected - (2.5 / 7) * 100) < 0.01);
  assert.ok(Math.abs(m.lv.weekRatio - 40 / ((2.5 / 7) * 100)) < 1e-9);
  assert.ok(Math.abs(m.lv.projRatio - 1.12) < 0.001);
  for (const k of ["session", "week", "today", "projection"]) assert.ok(m.math[k].length > 0, k);
});

test("early in the week the projection is not rated", () => {
  const m = run(reading({ used: 5, now: at(2026, 10, 28, 20) }));
  assert.equal(m.lv.projection, null);
});

test("a projection shown as 100% fits the week instead of running out", () => {
  const m = run(reading({ used: 100.3 / 2.8 }));
  assert.equal(m.forecast.kind, "fits");
});

// Today is Saturday 2026-11-07 15:00 and Sat and Sun are Off in the plan. Week: Wed 11-04 08:00 to Wed 11-11 08:00.
const OFF_PLAN = { weights: [0, 1, 1, 1, 1, 1, 0] };
function offToday({ spent, weights = OFF_PLAN.weights }) {
  const now = at(2026, 11, 7, 15);
  const used = 40 + spent;
  const src = {
    kind: "manual",
    data: {
      updatedAt: now,
      weekly: { used, resetsAt: at(2026, 11, 11, 8) },
      fiveHour: null,
      dayStart: { day: "2026-11-07", at: at(2026, 11, 7), used: 40 },
      days: { "2026-11-07": { spent, budget: 0, endUsed: used } },
    },
  };
  const sb = load(now, { weights });
  return vm.runInContext(`compute(${JSON.stringify(src)})`, sb);
}

test("an Off today has budget 0 and is not rated, with or without use", () => {
  for (const spent of [0, 6]) {
    const m = offToday({ spent });
    assert.equal(m.dayOff, true);
    assert.equal(m.budget, 0);
    assert.equal(m.spent, spent);
    assert.equal(m.todayRatio, 0, "no 200% sentinel");
    assert.equal(m.lv.today, null, "no day level, so no Pause");
    const today = m.week.find((d) => d.isToday);
    assert.equal(today.kind, "off");
    assert.equal(today.level, null);
    assert.equal(today.ratio, null);
    assert.equal(today.spent, spent);
    assert.equal(today.fill, 0);
  }
});

test("an Off today does not touch the session, week or projection levels, and counts the use", () => {
  const m = offToday({ spent: 6 });
  assert.equal(m.w.used, 46);
  assert.ok(m.lv.week !== null);
  assert.ok(m.lv.proj, "the projection still counts the use");
  assert.equal(m.head.level, m.lv.projection);
  // The same use on a normal Saturday is rated against a real budget
  const normal = offToday({ spent: 6, weights: [1, 1, 1, 1, 1, 1, 1] });
  assert.equal(normal.dayOff, false);
  assert.ok(normal.budget > 0);
  assert.notEqual(normal.lv.today, null);
});

test("another day being Off keeps its behavior: a future off day is off, a past off day with use is rated", () => {
  const m = offToday({ spent: 0 });
  const sun = m.week.find((d) => d.dow === 0);
  assert.equal(sun.when, "future");
  assert.equal(sun.kind, "off");
  assert.equal(sun.level, null);
  // Wed 11-04 is the first day; a past day off with recorded use is still judged by its record
  const past = m.week.find((d) => d.when === "past");
  assert.ok(past);
});

test("the pace chart marks nothing as over budget on an Off today", () => {
  const sb = load(at(2026, 11, 7, 15), OFF_PLAN);
  const m = vm.runInContext(`compute(${JSON.stringify({
    kind: "manual",
    data: { updatedAt: at(2026, 11, 7, 15), weekly: { used: 46, resetsAt: at(2026, 11, 11, 8) }, fiveHour: null,
      dayStart: { day: "2026-11-07", at: at(2026, 11, 7), used: 40 }, days: { "2026-11-07": { spent: 6, budget: 0, endUsed: 46 } } },
  })})`, sb);
  const series = vm.runInContext("(m) => paceSeries(m)", sb)(m);
  assert.equal(series.over.length, 0);
});
