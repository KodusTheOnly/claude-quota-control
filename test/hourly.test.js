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

test("a long gap with no session seen is spread over its active hours, as an estimate", () => {
  // 16:00 to 04:00, no session at either reading: a whole session nobody saw fits in it
  const readings = [
    { at: hour(16, 0), w: 0, s: null, sr: null },
    { at: hour(16, 0) + 12 * H, w: 6, s: null, sr: null },
  ];
  const now = hour(16, 0) + 13 * H;
  // Without active hours every hour is active: an even split
  const all = hourlyUsage({ readings, activity: new Map(), weekStart: hour(16, 0), now });
  assert.equal(all.left, 0);
  assert.ok(Math.abs(cellAt(all, 16).v - 0.5) < 1e-9);
  assert.equal(cellAt(all, 16).exact, false);
  // Active hours 08:00 to 22:00: only 16:00 to 22:00 can hold it
  const active = (from, to) => {
    let ms = 0;
    for (let t = from; t < to; t += MIN) if (new Date(t).getHours() >= 8 && new Date(t).getHours() < 22) ms += Math.min(MIN, to - t);
    return ms;
  };
  const r = hourlyUsage({ readings, activity: new Map(), weekStart: hour(16, 0), now, active });
  assert.ok(Math.abs(cellAt(r, 16).v - 1) < 1e-9);
  assert.ok(Math.abs(cellAt(r, 21).v - 1) < 1e-9);
  assert.equal(cellAt(r, 22).v, 0);
  assert.equal(cellAt(r, 22).blind, true);
  assert.equal(cellAt(r, 21).blind, false);
});

test("a long gap with nothing to go on, not even an active hour, is left out and blind", () => {
  const readings = [
    { at: hour(16, 0), w: 0, s: null, sr: null },
    { at: hour(16, 0) + 12 * H, w: 5, s: null, sr: null },
  ];
  const r = hourlyUsage({ readings, activity: new Map(), weekStart: hour(16, 0), now: hour(16, 0) + 13 * H, active: () => 0 });
  assert.equal(r.maxV, 0);
  assert.equal(r.left, 5);
  assert.equal(cellAt(r, 20).blind, true);
});

test("the sessions the readings saw weigh twice an active hour where one nobody saw may have run", () => {
  // The first reading saw a session ending at 18:00, the second one starting at 04:00 (resets 09:00). Between them,
  // 18:00 to 04:00 is 10 h: room for a session nobody saw.
  const readings = [
    { at: hour(16, 0), w: 0, s: 10, sr: hour(18) },
    { at: hour(16, 0) + 14 * H, w: 9, s: 30, sr: hour(16, 0) + 17 * H },
  ];
  const r = hourlyUsage({ readings, activity: new Map(), weekStart: hour(15, 0), now: hour(16, 0) + 15 * H });
  // Seen: 16:00-18:00 and 04:00-06:00 (4 h at 1). Unseen: 18:00-04:00 (10 h at 0.5). 9 h of weight in all.
  assert.ok(Math.abs(cellAt(r, 16).v - 1) < 1e-9);
  assert.ok(Math.abs(cellAt(r, 20).v - 0.5) < 1e-9);
  assert.equal(r.left, 0);
});

test("the stretches with no reading are the gaps of an hour or more in which the week went up", () => {
  const { readingGaps } = load();
  const readings = [
    { at: hour(16, 0), w: 2, s: 5, sr: hour(20), to: hour(16, 30) },
    { at: hour(17, 0), w: 3, s: 9, sr: hour(20) }, // 30 min after 16:30: too short
    { at: hour(20, 0), w: 3, s: 9, sr: hour(20) }, // 3 h, but nothing went up
    { at: hour(23, 0), w: 7, s: 20, sr: hour(23, 30) }, // 3 h and up 4: a gap
  ];
  const gaps = readingGaps({ readings, weekStart: WEEK, now: hour(23, 30) });
  assert.deepEqual(JSON.parse(JSON.stringify(gaps)), [{ from: hour(20, 0), to: hour(23, 0), w0: 3, w1: 7 }]);
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
