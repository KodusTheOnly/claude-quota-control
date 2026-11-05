const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// hourly.js is a plain browser script: load it in a sandbox
function load() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", "hourly.js"), "utf8"), sandbox);
  return sandbox;
}
const { hourlyUsage } = load();

const H = 3600000;
const MIN = 60000;
const WEEK = new Date(2026, 10, 3, 15, 0, 0, 0).getTime(); // Tue 15:00, the reset
const hour = (h, m = 0) => new Date(2026, 10, 3, h, m, 0, 0).getTime();
const cellAt = (res, h) => res.cells.get(hour(h));

test("readings a few minutes apart place the increase exactly there", () => {
  const readings = [
    { at: hour(16, 0), w: 4, s: 10, sr: hour(20) },
    { at: hour(16, 5), w: 6, s: 14, sr: hour(20) },
  ];
  const r = hourlyUsage({ readings, activity: new Map(), weekStart: WEEK, now: hour(17) });
  assert.equal(cellAt(r, 16).v, 2);
  assert.equal(cellAt(r, 16).exact, true);
  // the first 4% came after a gap of an hour from the week start: placed there, as an estimate
  assert.equal(cellAt(r, 15).v, 4);
  assert.equal(cellAt(r, 15).exact, false);
});

test("a long gap is split over the hours the session was running", () => {
  // Session window 17:00 to 22:00. Readings at 16:00 and 19:00: only 17:00 to 19:00 can hold usage.
  const readings = [
    { at: hour(16, 0), w: 0, s: 0, sr: null },
    { at: hour(19, 0), w: 6, s: 30, sr: hour(22) },
  ];
  const r = hourlyUsage({ readings, activity: new Map(), weekStart: hour(16, 0), now: hour(20) });
  assert.equal(cellAt(r, 16).v, 0);
  assert.ok(Math.abs(cellAt(r, 17).v - 3) < 1e-9);
  assert.ok(Math.abs(cellAt(r, 18).v - 3) < 1e-9);
  assert.equal(cellAt(r, 17).exact, false);
});

test("Claude Code activity decides how an increase is split", () => {
  const readings = [
    { at: hour(16, 0), w: 0, s: 0, sr: hour(21) },
    { at: hour(18, 0), w: 8, s: 40, sr: hour(21) },
  ];
  const activity = new Map([[hour(16), 1], [hour(17), 3]]);
  const r = hourlyUsage({ readings, activity, weekStart: hour(16, 0), now: hour(19) });
  assert.ok(Math.abs(cellAt(r, 16).v - 2) < 1e-9);
  assert.ok(Math.abs(cellAt(r, 17).v - 6) < 1e-9);
});

test("a long gap with nothing to go on is left out, not smeared", () => {
  const readings = [
    { at: hour(16, 0), w: 0, s: null, sr: null },
    { at: hour(16, 0) + 12 * H, w: 5, s: null, sr: null },
  ];
  const r = hourlyUsage({ readings, activity: new Map(), weekStart: hour(16, 0), now: hour(16, 0) + 13 * H });
  assert.equal(r.maxV, 0);
  assert.equal(r.left, 5);
});

test("a gap with no increase marks the hours as covered with zero use", () => {
  const readings = [
    { at: hour(16, 0), w: 3, s: 5, sr: hour(21), to: hour(18, 30) },
  ];
  const r = hourlyUsage({ readings, activity: new Map(), weekStart: hour(15, 30), now: hour(19) });
  assert.equal(cellAt(r, 17).covered, true);
  assert.equal(cellAt(r, 17).v, 0);
});

test("readings from before the week started are ignored", () => {
  const readings = [{ at: WEEK - 5 * H, w: 90, s: 10, sr: null }, { at: hour(16), w: 2, s: 5, sr: hour(20) }];
  const r = hourlyUsage({ readings, activity: new Map(), weekStart: WEEK, now: hour(17) });
  assert.ok(r.maxV <= 2 + 1e-9);
});
