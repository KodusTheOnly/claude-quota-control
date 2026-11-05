const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// core.js and compute.js are plain browser scripts that share one scope: load them in a sandbox.
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
  for (const f of ["core.js", "compute.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext(`state.settings = ${JSON.stringify(settings)};`, sandbox);
  return sandbox;
}
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const plain = (v) => JSON.parse(JSON.stringify(v));

// The week of test/pace.test.js: Wed 2026-10-28 08:00 to Wed 11-04 08:00, now Fri 10-30 20:00 (today is day 2)
const NOW = at(2026, 10, 30, 20);
const RESET = at(2026, 11, 4, 8);
const MANUAL = {
  anchor: RESET, updatedAt: NOW, via: "manual",
  weekly: { used: 33, resetsAt: RESET }, fiveHour: null,
  dayStart: { day: "2026-10-30", at: at(2026, 10, 30), used: 28 },
  days: {
    "2026-10-28": { spent: 20, budget: 14.3, endUsed: 20 },
    "2026-10-29": { spent: 8, budget: 14.3, endUsed: 28 },
    "2026-10-30": { spent: 5, budget: 14.3, endUsed: 33 },
  },
};
function week(weights, expr) {
  const sb = load(NOW, { manual: MANUAL, ...(weights ? { weights } : {}) });
  vm.runInContext("var __m = compute({ kind: 'manual', data: " + JSON.stringify(MANUAL) + " });", sb);
  return plain(vm.runInContext(expr, sb));
}

test("the plan menu preview of every option equals the budget the day shows once it is chosen (a day ahead and today)", () => {
  const base = week(null, "__m.week.map((d) => ({ dow: d.dow, when: d.when, weight: d.weight }))");
  assert.deepEqual([base[2].when, base[3].when], ["today", "future"]);
  for (const i of [2, 3, 5]) {
    for (const wt of [1, 0.5, 2, 0]) {
      const preview = week(null, `previewBudget(__m, ${i}, ${wt})`);
      const w = [1, 1, 1, 1, 1, 1, 1];
      w[base[i].dow] = wt;
      const real = week(w, `__m.week[${i}].budget`);
      assert.equal(preview, real, `day ${i}, weight ${wt}`);
    }
  }
});

test("the preview of Off is zero, and of a heavier option is more than a lighter one", () => {
  for (const i of [2, 3]) {
    const [normal, light, heavy, off] = [1, 0.5, 2, 0].map((wt) => week(null, `previewBudget(__m, ${i}, ${wt})`));
    assert.equal(off, 0);
    assert.ok(light < normal && normal < heavy);
  }
});

// limitsFirst reads only a few fields of the numbers: build them by hand
function first(m) {
  const sb = load(0);
  sb.__m = m;
  return plain(vm.runInContext("limitsFirst(__m)", sb));
}
const N = at(2026, 10, 30, 12);
const SR = N + 3 * 3600000;
const base = (extra) => ({ now: N, w: { resetsAt: at(2026, 11, 4, 8) }, five: { resetsAt: SR }, pace: { known: true, fullAt: null }, forecast: { kind: "fits" }, ...extra });

test("limits you first: the session alone", () => {
  assert.deepEqual(first(base({ pace: { known: true, fullAt: N + 3600000 } })), { kind: "session", ms: N + 3600000 });
});

test("limits you first: the week alone", () => {
  const eta = at(2026, 11, 2, 5, 12);
  assert.deepEqual(first(base({ forecast: { kind: "short", eta } })), { kind: "week", ms: eta });
});

test("limits you first: with both, the earlier one wins", () => {
  const eta = at(2026, 11, 2, 5, 12);
  assert.equal(first(base({ pace: { known: true, fullAt: N + 3600000 }, forecast: { kind: "short", eta } })).kind, "session");
  assert.equal(first(base({ pace: { known: true, fullAt: N + 3600000 }, forecast: { kind: "short", eta: N + 1800000 } })).kind, "week");
});

test("limits you first: nothing reaches a limit, nothing to say", () => {
  assert.equal(first(base()), null);
  assert.equal(first(base({ five: null, pace: null })), null);
});

test("limits you first: a session that would fill after its own reset is ignored", () => {
  assert.equal(first(base({ pace: { known: true, fullAt: SR + 60000 } })), null);
});

test("limits you first: still early (no week projection), only the session counts", () => {
  assert.equal(first(base({ forecast: { kind: "early" } })), null);
  assert.deepEqual(first(base({ forecast: { kind: "early" }, pace: { known: true, fullAt: N + 3600000 } })), { kind: "session", ms: N + 3600000 });
});
