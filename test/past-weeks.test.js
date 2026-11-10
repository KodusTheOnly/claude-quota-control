const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load() {
  const sandbox = { document: { getElementById: () => ({}) }, window: { quota: {} }, I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" } };
  vm.createContext(sandbox);
  for (const f of ["core.js", "compute.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  return sandbox;
}
const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const plain = (v) => JSON.parse(JSON.stringify(v));
// This week runs Tue 2026-11-10 08:00 to Tue 11-17 08:00
const RESET = at(2026, 11, 17, 8);

function run(days, n) {
  const sb = load();
  sb.__days = days;
  return plain(vm.runInContext(`pastWeeks(__days, ${RESET}${n ? `, ${n}` : ""})`, sb));
}

test("a past week is the end of each of its days, from its reset", () => {
  const weeks = run({ "2026-11-03": { spent: 20, endUsed: 20 }, "2026-11-04": { spent: 15, endUsed: 35 }, "2026-11-09": { spent: 30, endUsed: 90 } });
  assert.equal(weeks.length, 1);
  const w = weeks[0];
  assert.equal(w.start, at(2026, 11, 3, 8));
  assert.equal(w.pts[0].y, 0);
  assert.ok(Math.abs(w.pts[0].x - 8 / 24) < 1e-9); // the reset at 08:00
  assert.deepEqual(w.pts.slice(1), [{ x: 1, y: 20 }, { x: 2, y: 35 }, { x: 7, y: 90 }]);
  assert.equal(w.end, 90);
  assert.equal(w.fullDay, null);
});

test("the next reset's day belongs to the week after", () => {
  // 11-10 is this week's first day: it must not end the week of 11-03
  const [w] = run({ "2026-11-03": { spent: 20, endUsed: 20 }, "2026-11-10": { spent: 5, endUsed: 5 } });
  assert.equal(w.end, 20);
});

test("a first day that still holds the week before's number is dropped", () => {
  const [w] = run({ "2026-11-03": { spent: 1, endUsed: 97 }, "2026-11-04": { spent: 10, endUsed: 10 } });
  assert.deepEqual(w.pts.slice(1), [{ x: 2, y: 10 }]);
});

test("the day a week reached 100% is kept, and weeks with no record are left out", () => {
  const weeks = run({ "2026-10-27": { spent: 60, endUsed: 60 }, "2026-11-01": { spent: 40, endUsed: 100 } });
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].start, at(2026, 10, 27, 8));
  assert.equal(weeks[0].fullDay, at(2026, 11, 1));
});

test("pastWeekAt follows the line and holds its last point", () => {
  const sb = load();
  const w = { pts: [{ x: 0.5, y: 0 }, { x: 1, y: 20 }, { x: 2, y: 40 }] };
  sb.__w = w;
  assert.equal(vm.runInContext("pastWeekAt(__w, 0.2)", sb), 0);
  assert.equal(vm.runInContext("pastWeekAt(__w, 1.5)", sb), 30);
  assert.equal(vm.runInContext("pastWeekAt(__w, 5)", sb), 40);
});
