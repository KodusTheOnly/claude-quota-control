const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// core.js, compute.js and hourly.js are plain browser scripts that share one scope: load them in a sandbox.
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
  for (const f of ["core.js", "compute.js", "hourly.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext(`state.settings = ${JSON.stringify(settings)};`, sandbox);
  return sandbox;
}
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const plain = (v) => JSON.parse(JSON.stringify(v));
const H = 3600000;

// The cells as hourlyUsage returns them: a Map made inside the sandbox
const mapOf = (sb, list) => vm.runInContext("(a) => new Map(a)", sb)(list.map(([ms, v, exact]) => [ms, { v, exact, covered: true }]));

// A day (Thu 2026-10-29) that went from 10% to 30%; cellList is a list of [hourStart, v, exact]
function steps(cellList, { from = at(2026, 10, 29), to = at(2026, 10, 30), y0 = 10, y1 = 30 } = {}) {
  const sb = load(to);
  sb.__cells = mapOf(sb, cellList);
  sb.__args = { from, to, y0, y1 };
  return plain(vm.runInContext("hourlySteps({ cells: __cells, ...__args })", sb));
}

test("a day with use in two hours is flat, rises, flat, rises, flat", () => {
  const pts = steps([[at(2026, 10, 29, 9), 3, true], [at(2026, 10, 29, 15), 1, true]]);
  assert.deepEqual(pts.map((p) => [p.ms, p.y]), [
    [at(2026, 10, 29), 10],
    [at(2026, 10, 29, 9), 10], [at(2026, 10, 29, 10), 25], // 3 of 4 parts of the 20 points
    [at(2026, 10, 29, 15), 25], [at(2026, 10, 29, 16), 30],
    [at(2026, 10, 30), 30],
  ]);
});

test("the steps start and end exactly at the recorded values, and the rises add up to the day's increase", () => {
  const pts = steps([[at(2026, 10, 29, 3), 0.7, true], [at(2026, 10, 29, 4), 0.1, true], [at(2026, 10, 29, 22), 0.3, true]], { y0: 12.3, y1: 47.9 });
  assert.equal(pts[0].y, 12.3);
  assert.equal(pts[pts.length - 1].y, 47.9);
  let rise = 0;
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].y >= pts[i - 1].y && pts[i].ms >= pts[i - 1].ms);
    rise += pts[i].y - pts[i - 1].y;
  }
  assert.ok(Math.abs(rise - (47.9 - 12.3)) < 1e-9);
});

test("an hour with no use stays flat, even between two hours with use", () => {
  const pts = steps([[at(2026, 10, 29, 9), 1, true], [at(2026, 10, 29, 11), 1, true], [at(2026, 10, 29, 10), 0, true]]);
  const between = pts.filter((p) => p.ms >= at(2026, 10, 29, 10) && p.ms <= at(2026, 10, 29, 11));
  assert.ok(between.every((p) => p.y === 20));
});

test("a day the hours know nothing about stays a straight piece (null)", () => {
  assert.equal(steps([]), null);
  assert.equal(steps([[at(2026, 10, 29, 9), 0, true]]), null); // covered but nothing placed, while the day rose
  assert.equal(steps([[at(2026, 10, 29, 9), 2, true]], { y0: 10, y1: 10 }), null); // no rise: nothing to place
  assert.equal(steps([[at(2026, 10, 28, 9), 2, true]]), null); // cells of another day do not count
});

test("a piece from estimated cells is flagged, the rest is not", () => {
  const pts = steps([[at(2026, 10, 29, 9), 1, true], [at(2026, 10, 29, 15), 1, false]]);
  const est = pts.filter((p) => p.est).map((p) => p.ms);
  assert.deepEqual(est, [at(2026, 10, 29, 16)]);
});

test("the part of a line above a level starts where it crosses it", () => {
  const sb = load(0);
  const above = plain(vm.runInContext("lineAbove([{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 2, y: 10 }, { x: 3, y: 20 }], 5)", sb));
  assert.deepEqual(above, [{ x: 0.5, y: 5 }, { x: 1, y: 10 }, { x: 2, y: 10 }, { x: 3, y: 20 }]);
  assert.equal(vm.runInContext("lineAbove([{ x: 0, y: 0 }, { x: 1, y: 3 }], 5)", sb), null);
});

// The week of test/pace.test.js: Wed 2026-10-28 08:00 to Wed 11-04 08:00, now Fri 10-30 20:00
const RESET = at(2026, 11, 4, 8);
function series(cellList) {
  const now = at(2026, 10, 30, 20);
  const manual = {
    anchor: RESET, updatedAt: now, via: "manual",
    weekly: { used: 33, resetsAt: RESET }, fiveHour: null,
    dayStart: { day: "2026-10-30", at: at(2026, 10, 30), used: 28 },
    days: {
      "2026-10-28": { spent: 20, budget: 14.3, endUsed: 20 },
      "2026-10-29": { spent: 8, budget: 14.3, endUsed: 28 },
      "2026-10-30": { spent: 5, budget: 14.3, endUsed: 33 },
    },
  };
  const sb = load(now, { manual });
  sb.__cells = cellList ? mapOf(sb, cellList) : null;
  vm.runInContext("var __m = compute(" + JSON.stringify({ kind: "manual", data: manual }) + ");", sb);
  return plain(vm.runInContext("paceSeries(__m, __cells)", sb));
}

test("the chart's used line goes up in steps, starts at 0 and ends at the week's use at NOW", () => {
  const s = series([
    [at(2026, 10, 28, 10), 5, true], [at(2026, 10, 28, 14), 15, false], // Wednesday: 20 in two hours
    [at(2026, 10, 30, 18), 1, true], // today: 28 -> 33 in one hour
  ]);
  assert.deepEqual(s.used[0], { x: s.s0, y: 0 });
  assert.equal(s.used.find((p) => p.x === 1).y, 20);
  // Wednesday: flat at 0, up 5 (10:00-11:00), flat, up 15 (14:00-15:00, an estimate), flat at 20
  const wed = s.used.filter((p) => p.x <= 1);
  assert.deepEqual(wed.map((p) => p.y), [0, 0, 5, 5, 20, 20]);
  assert.equal(wed.filter((p) => p.est).length, 1);
  const last = s.used[s.used.length - 1];
  assert.ok(Math.abs(last.x - s.nowX) < 1e-9);
  assert.equal(last.y, 33);
  assert.ok(s.used.some((p) => p.y === 28 && p.x > 2 && p.x < 2.76), "today is flat at 28 until 18:00");
  // Thursday had no cells: a straight piece (a single point at the end of the day)
  assert.equal(s.used.filter((p) => p.x > 1 && p.x <= 2).length, 1);
});

test("the red part follows the steps: only what is above the day's budget", () => {
  const s = series([[at(2026, 10, 28, 10), 5, true], [at(2026, 10, 28, 14), 15, true]]);
  // Wednesday spent 20 of 14.3: the line is red from 14.3 up to 20, which is inside the second rise
  assert.equal(s.over.length, 1);
  assert.ok(Math.abs(s.over[0][0].y - 14.3) < 1e-9);
  assert.equal(s.over[0][s.over[0].length - 1].y, 20);
  assert.ok(s.over[0][0].x > 14 / 24 && s.over[0][0].x < 15 / 24);
});

test("without cells the used line is the straight one it always was", () => {
  const s = series(null);
  assert.deepEqual(s.used.slice(0, 3), [{ x: s.s0, y: 0 }, { x: 1, y: 20 }, { x: 2, y: 28 }]);
});

test("session starts are sr - 5 h of each window in the readings, grouped when under 10 minutes apart", () => {
  const sb = load(at(2026, 10, 30, 20));
  const sr1 = at(2026, 10, 29, 13);
  const sr2 = at(2026, 10, 30, 3);
  sb.__r = [
    { at: at(2026, 10, 29, 9), w: 1, s: 5, sr: sr1 },
    { at: at(2026, 10, 29, 10), w: 2, s: 9, sr: sr1 + 4 * 60000 }, // the same window, reset read a bit later
    { at: at(2026, 10, 29, 11), w: 2, s: 9 }, // no sr: ignored
    { at: at(2026, 10, 30, 0), w: 3, s: 1, sr: sr2 },
    { at: at(2026, 10, 25, 9), w: 3, s: 1, sr: at(2026, 10, 25, 13) }, // last week
  ];
  const starts = plain(vm.runInContext("sessionStartsFrom(__r, " + at(2026, 10, 28, 8) + ", " + at(2026, 10, 30, 20) + ")", sb));
  assert.deepEqual(starts, [sr1 - 5 * H, sr2 - 5 * H]);
  assert.deepEqual(plain(vm.runInContext("sessionStartsFrom(undefined, 0, 1)", sb)), []);
});
