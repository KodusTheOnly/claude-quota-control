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

test("the projection reads Free below 80%, Moderate up to 100%, Tight up to 140%, Pause above", () => {
  // 2.5 of 7 days passed: 35.7% expected. Projection = used / 2.5 * 7
  assert.equal(run(reading({ used: 15 })).lv.projection, 0); // projects 42%
  assert.equal(run(reading({ used: 27 })).lv.projection, 0); // projects 75.6%
  assert.equal(run(reading({ used: 30 })).lv.projection, 1); // projects 84%
  assert.equal(run(reading({ used: 40 })).lv.projection, 2); // projects 112%
  assert.equal(run(reading({ used: 60 })).lv.projection, 3); // projects 168%
});

test("a Free answer says how much would be left at the reset, as a plain fact", () => {
  const m = run(reading({ used: 25 })); // projects 70%
  assert.equal(m.head.level, 0);
  assert.ok(m.head.reason.includes('reason.free.leftAtReset {"pct":"30%"}'), m.head.reason);
});

test("from 80% projected the answer is Moderate and says nothing about what is left", () => {
  const m = run(reading({ used: 30 })); // projects 84%
  assert.equal(m.lv.projection, 1);
  assert.equal(m.head.level, 1);
  assert.ok(!m.head.reason.includes("leftAtReset"));
});

test("without a projection yet, a Free answer does not guess what is left", () => {
  const m = run(reading({ used: 5, now: at(2026, 10, 28, 20) }));
  assert.equal(m.head.level, 0);
  assert.ok(!m.head.reason.includes("leftAtReset"));
});

test("while the verdict still reads early (under 1% used), the Free answer does not add what is left", () => {
  const m = run(reading({ used: 0.5 }));
  assert.equal(m.forecast.kind, "early");
  assert.equal(m.lv.projection, 0);
  assert.ok(!m.head.reason.includes("leftAtReset"));
});

test("the week level follows the projection, not used / expected", () => {
  const m = run(reading({ used: 27 })); // used / expected 0.756 (Moderate on the ratio scale), projects 75.6%
  assert.ok(m.lv.weekRatio > 0.7);
  assert.equal(m.lv.week, 0);
  assert.equal(m.lv.week, m.lv.projection);
  assert.equal(run(reading({ used: 30 })).lv.week, 1); // projects 84%
  assert.equal(run(reading({ used: 40 })).lv.week, 2); // projects 112%
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

test("with a projection, the week's math shows the projection scale", () => {
  const m = run(reading({ used: 27 }));
  assert.equal(m.math.week.find(([k]) => k === "math.weekScale")[1], "math.weekScaleProj");
  assert.ok(m.math.week.some(([k]) => k === "math.cutoffsProjection"));
  assert.ok(!m.math.week.some(([k]) => k === "math.cutoffsRatio"));
  assert.ok(m.math.today.some(([k]) => k === "math.cutoffsRatio"), "Today keeps the ratio scale");
});

test("the math rows show the projection's own cutoffs", () => {
  const m = run(reading({ used: 25 }));
  const row = m.math.projection.find(([k]) => k === "math.cutoffsProjection");
  assert.ok(row, "a cutoffs row");
  assert.equal(row[1], 'math.cutoffsProjectionValue {"a":"80%","b":"100%","c":"140%"}');
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
  assert.ok(Math.abs(m.lv.expected - (2.5 / 7) * 100) < 0.01);
  assert.ok(Math.abs(m.lv.weekRatio - 40 / ((2.5 / 7) * 100)) < 1e-9);
  assert.ok(Math.abs(m.lv.projRatio - 1.12) < 0.001);
  for (const k of ["session", "week", "today", "projection"]) assert.ok(m.math[k].length > 0, k);
});

test("early in the week the projection is not rated", () => {
  const m = run(reading({ used: 5, now: at(2026, 10, 28, 20) }));
  assert.equal(m.lv.projection, null);
});

test("the projection is rated as shown: 79.4% reads Free, 79.6% (shown as 80%) reads Moderate", () => {
  // 2.5 of 7 weighted days passed, so the projection is used * 2.8
  const free = run(reading({ used: 79.4 / 2.8 }));
  assert.equal(free.lv.projection, 0);
  assert.equal(free.lv.week, 0);
  assert.equal(free.head.level, 0);
  const moderate = run(reading({ used: 79.6 / 2.8 }));
  assert.equal(Math.round(moderate.lv.proj.projected), 80);
  assert.equal(moderate.lv.projection, 1);
  assert.equal(moderate.lv.week, 1);
  assert.equal(moderate.head.level, 1);
  assert.ok(!moderate.head.reason.includes("leftAtReset"), "Moderate does not add what is left");
});

test("a projection shown as 100% fits the week instead of running out", () => {
  const m = run(reading({ used: 100.3 / 2.8 }));
  assert.equal(m.lv.projection, 1);
  assert.equal(m.forecast.kind, "fits");
});
