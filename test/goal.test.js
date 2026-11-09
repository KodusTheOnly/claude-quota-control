const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// The week's plan and the emergency reserve (Settings, Reserve): the plan always ends at 100%. The budget, the
// expected line, the verdict's two modes (room to spend, on the reserve) and the pace needed against the pace so far.

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
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const EVEN = [1, 1, 1, 1, 1, 1, 1];

// Week: Wed 2026-10-28 08:00 to Wed 2026-11-04 08:00, even plan. Now: Fri 10-30 20:00 (2.5 days in, 4.5 left).
const RESET = at(2026, 11, 4, 8);
function run(used, settings = {}, now = at(2026, 10, 30, 20)) {
  const src = {
    kind: "manual",
    data: {
      updatedAt: now,
      weekly: { used, resetsAt: RESET },
      fiveHour: null,
      dayStart: { day: "2026-10-30", at: at(2026, 10, 30), used: used - 5 },
      days: { "2026-10-30": { spent: 5, budget: 10, endUsed: used } },
    },
  };
  const sb = load(now, settings);
  return { m: vm.runInContext(`compute(${JSON.stringify(src)})`, sb), sb };
}

test("the reserve is read from the settings and kept in range; the goal is always 100%", () => {
  const sb = load(at(2026, 10, 30, 20));
  const g = (s) => JSON.parse(vm.runInContext(`JSON.stringify(goalSettings(${JSON.stringify(s)}))`, sb));
  assert.deepEqual(g({}), { goal: 100, reserve: 0, release: 48 });
  assert.deepEqual(g(null), { goal: 100, reserve: 0, release: 48 });
  assert.deepEqual(g({ reserve: 50, reserveRelease: 72 }), { goal: 100, reserve: 20, release: 72 });
  assert.deepEqual(g({ reserve: 10, reserveRelease: 5 }), { goal: 100, reserve: 10, release: 48 });
  assert.deepEqual(g({ goal: 55, reserve: 10, reserveRelease: 0 }), { goal: 100, reserve: 10, release: 0 }, "a goal from an older version is ignored");
  assert.deepEqual(g({ reserve: "x" }), { goal: 100, reserve: 0, release: 48 });
});

test("the reserve is held until its release starts, then melts in a straight line to the reset", () => {
  const sb = load(at(2026, 10, 30, 20));
  const held = (ms, g) => vm.runInContext(`reserveHeld(${ms}, ${RESET}, ${JSON.stringify(g)})`, sb);
  const g = { goal: 100, reserve: 10, release: 48 };
  assert.equal(held(at(2026, 10, 30, 20), g), 10);
  assert.equal(held(at(2026, 11, 2, 8), g), 10); // the release starts 48 h before the reset
  assert.ok(near(held(at(2026, 11, 3, 8), g), 5));
  assert.equal(held(RESET, g), 0);
  assert.equal(held(at(2026, 11, 3, 8), { ...g, release: 0 }), 10, "never released");
  assert.equal(held(at(2026, 11, 3, 8), { ...g, reserve: 0 }), 0);
});

test("without a reserve the budget splits what is left to 100%", () => {
  const sb = load(at(2026, 10, 30, 20));
  const call = (expr) => vm.runInContext(expr, sb);
  const now = at(2026, 10, 30, 10);
  assert.ok(near(call(`planBudget(40, ${RESET}, ${now}, FULL_WEEK, ${JSON.stringify(EVEN)})`), call(`dayBudget(60, ${RESET}, ${now}, ${JSON.stringify(EVEN)})`)));
  // With a reserve held all day, only the plan (100 - reserve) is split
  assert.ok(near(call(`planBudget(40, ${RESET}, ${now}, { goal: 100, reserve: 10, release: 48 }, ${JSON.stringify(EVEN)})`), call(`dayBudget(50, ${RESET}, ${now}, ${JSON.stringify(EVEN)})`)));
});

test("on a day the release covers, the budget gets that day's share of the reserve left", () => {
  const sb = load(at(2026, 11, 2, 10));
  const call = (expr) => vm.runInContext(expr, sb);
  const g = JSON.stringify({ goal: 100, reserve: 10, release: 48 });
  const now = at(2026, 11, 2, 10); // Monday: the release runs from Mon 08:00 to Wed 08:00
  const plan = call(`dayBudget(10, ${RESET}, ${now}, ${JSON.stringify(EVEN)})`); // 90 - 80
  // From Mon 00:00 the whole reserve is held; by Tue 00:00 a third of it (16 of 48 h) is released
  assert.ok(near(call(`planBudget(80, ${RESET}, ${now}, ${g}, ${JSON.stringify(EVEN)})`), plan + 10 / 3));
  // Half the reserve already used: half as much is released
  const planHalf = call(`dayBudget(0, ${RESET}, ${now}, ${JSON.stringify(EVEN)})`);
  assert.ok(near(call(`planBudget(95, ${RESET}, ${now}, ${g}, ${JSON.stringify(EVEN)})`), planHalf + 5 / 3));
  // Never released: the reserve stays out of the budget
  assert.ok(near(call(`planBudget(80, ${RESET}, ${now}, ${JSON.stringify({ goal: 100, reserve: 10, release: 0 })}, ${JSON.stringify(EVEN)})`), plan));
});

test("the expected line ends at 100%, the reserve joining it while it is released", () => {
  const sb = load(at(2026, 10, 30, 20));
  const exp = (ms, g) => vm.runInContext(`expectedUsed(${RESET}, ${ms}, ${JSON.stringify(EVEN)}, ${JSON.stringify(g)})`, sb);
  const g = { goal: 100, reserve: 10, release: 48 };
  assert.ok(near(exp(RESET, g), 100));
  assert.ok(near(exp(at(2026, 11, 2, 8), g), (90 * 5) / 7), "before the release, only the plan");
  assert.ok(near(exp(RESET, { ...g, release: 0 }), 90), "never released: the plan ends at 100 - reserve");
  assert.ok(near(exp(RESET, { goal: 100, reserve: 0, release: 0 }), 100));
});

test("by default the plan aims at 100% with no reserve, even with a goal saved by an older version", () => {
  const { m } = run(30, { goal: 97 });
  assert.deepEqual(JSON.parse(JSON.stringify(m.g)), { goal: 100, reserve: 0, release: 48 });
  assert.equal(m.ceiling, 100);
  assert.equal(m.reserveMode, false);
});

test("room to spend: no lockout ahead, but the pace ends more than 8 points under the plan", () => {
  // 20% in 2.5 days projects 56%, 44 points under 100%
  const low = run(20).m;
  assert.equal(low.head.level, 0);
  assert.equal(low.head.room, true);
  // 33% projects 92.4%, under 100% but by less than 8 points
  const close = run(33).m;
  assert.equal(close.head.room, false);
  // A reserve held moves the line: 28% projects 78.4%, room under 100% but on plan under 80% (a 20% reserve)
  assert.equal(run(28).m.head.room, true);
  assert.equal(run(28, { reserve: 20 }).m.head.room, false);
  // Too early to project: no room either
  assert.equal(run(0.5).m.head.room, false);
});

test("the pace needed to end at the plan's ceiling and the pace so far", () => {
  const { m } = run(30);
  assert.ok(near(m.lv.doing, 12)); // 30% in 2.5 plan days
  assert.ok(near(m.lv.need, (100 - 30) / 4.5));
  const res = run(30, { reserve: 10 }).m;
  assert.ok(near(res.lv.need, (90 - 30) / 4.5), "the reserve still held is not asked for");
});

test("above the plan's ceiling the week is on the reserve: today is not rated and nothing is over budget", () => {
  const { m } = run(92, { reserve: 10 });
  assert.equal(m.ceiling, 90);
  assert.equal(m.reserveMode, true);
  assert.equal(m.head.reserve, true);
  assert.equal(m.lv.today, null);
  assert.equal(m.week.find((d) => d.isToday).ratio, null);
  // Without a reserve the same use is not a reserve mode
  assert.equal(run(92).m.reserveMode, false);
  // At 100% it is no longer the reserve: the levels take over
  assert.equal(run(100, { reserve: 10 }).m.reserveMode, false);
});

test("the chart's reserve band runs from 100 - reserve and rises to 100 while it is released", () => {
  const { sb } = run(30, { reserve: 10 });
  const s = JSON.parse(vm.runInContext(`JSON.stringify(paceSeries(compute(${JSON.stringify({
    kind: "manual",
    data: { updatedAt: at(2026, 10, 30, 20), weekly: { used: 30, resetsAt: RESET }, fiveHour: null, dayStart: { day: "2026-10-30", at: at(2026, 10, 30), used: 25 }, days: {} },
  })})))`, sb));
  assert.equal(s.goal, 100);
  assert.equal(s.reserve[0].y, 90);
  assert.equal(s.reserve[1].y, 90);
  assert.equal(s.reserve[s.reserve.length - 1].y, 100);
  assert.equal(s.expected[s.expected.length - 1].y, 100);
});
