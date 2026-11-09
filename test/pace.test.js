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
    I18N: { t: (k) => k, getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "compute.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext(`state.settings = ${JSON.stringify(settings)};`, sandbox);
  return sandbox;
}
const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const plain = (v) => JSON.parse(JSON.stringify(v)); // data that crossed the sandbox, safe to compare

// The week runs Wed 2026-10-28 08:00 to Wed 2026-11-04 08:00. Now: Fri 10-30 20:00, with two recorded days.
const RESET = at(2026, 11, 4, 8);
function reading({ used = 33, days, now = at(2026, 10, 30, 20), settings = {} } = {}) {
  return {
    now,
    settings,
    src: {
      kind: "manual",
      data: {
        updatedAt: now,
        weekly: { used, resetsAt: RESET },
        fiveHour: null,
        dayStart: { day: "2026-10-30", at: at(2026, 10, 30), used: 28 },
        days: days || {
          "2026-10-28": { spent: 20, budget: 14.3, endUsed: 20 },
          "2026-10-29": { spent: 8, budget: 14.3, endUsed: 28 },
          "2026-10-30": { spent: used - 28, budget: 14.3, endUsed: used },
        },
      },
    },
  };
}
function run(r, expr) {
  // The reading is the manual one, which is also where the app keeps its day records
  const sb = load(r.now, { ...r.settings, manual: r.src.data });
  sb.__src = r.src;
  vm.runInContext("var __m = compute(__src);", sb);
  return plain(vm.runInContext(expr, sb));
}

test("the plan starts on the weekday of the reset and marks today", () => {
  const plan = run(reading(), "weekPlan(__m)");
  assert.equal(plan.length, 7);
  assert.equal(plan[0].dow, 3); // Wednesday, the weekday of the reset
  assert.equal(plan.filter((d) => d.isToday).length, 1);
  assert.equal(plan[2].isToday, true); // Friday
  assert.deepEqual(plan.map((d) => d.kind), ["past", "past", "today", "future", "future", "future", "future"]);
});

test("past days use what was recorded, and are rated by spent over budget", () => {
  const plan = run(reading(), "weekPlan(__m)");
  assert.equal(plan[0].spent, 20);
  assert.ok(Math.abs(plan[0].ratio - 20 / 14.3) < 1e-9);
  assert.equal(plan[0].level, 2); // 1.4 is Tight, a little over
  assert.equal(plan[1].level, 0); // 0.56 is Free
  assert.equal(plan[3].level, null); // days ahead are not rated
});

test("days ahead split what is left in proportion to their weights", () => {
  // Days ahead: Sat, Sun, Mon, Tue. With the same weight they get the same budget.
  const even = run(reading(), "weekPlan(__m)");
  const ahead = even.slice(3).map((d) => d.budget);
  assert.ok(ahead.every((b) => Math.abs(b - ahead[0]) < 1e-9 && b > 0));

  // Saturday heavy (2x) and Sunday off (the list starts on Sunday): Saturday takes twice a normal day, Sunday nothing
  const weights = [0, 1, 1, 1, 1, 1, 2];
  const plan = run(reading({ settings: { weights } }), "weekPlan(__m)");
  assert.ok(Math.abs(plan[3].budget / plan[5].budget - 2) < 1e-9);
  assert.equal(plan[4].budget, 0);
  assert.equal(plan[4].kind, "off");
  assert.equal(plan[3].name, "heavy");
});

test("the pace chart is measured in days from the midnight that starts the plan", () => {
  const s = run(reading(), "paceSeries(__m)");
  assert.ok(Math.abs(s.s0 - 8 / 24) < 1e-9, "the week starts a third of the way into the first day");
  assert.ok(Math.abs(s.span - (7 + 8 / 24)) < 1e-9, "and ends a week later");
  assert.ok(Math.abs(s.nowX - (2 + 20 / 24)) < 1e-9);
  assert.equal(s.todayIdx, 2);
});

test("the expected line rises from 0 to 100% and never goes backwards", () => {
  const s = run(reading(), "paceSeries(__m)");
  assert.deepEqual([s.expected[0].x, s.expected[0].y], [s.s0, 0]);
  const last = s.expected[s.expected.length - 1];
  assert.deepEqual([last.x, last.y], [s.span, 100]);
  for (let i = 1; i < s.expected.length; i++) {
    assert.ok(s.expected[i].x > s.expected[i - 1].x);
    assert.ok(s.expected[i].y >= s.expected[i - 1].y);
  }
});

test("the used line follows the recorded days and ends at what is used now", () => {
  const s = run(reading(), "paceSeries(__m)");
  assert.deepEqual(s.used[0], { x: s.s0, y: 0 });
  assert.deepEqual(s.used[1], { x: 1, y: 20 }); // end of Wednesday
  assert.deepEqual(s.used[2], { x: 2, y: 28 }); // end of Thursday
  const last = s.used[s.used.length - 1];
  assert.ok(Math.abs(last.x - s.nowX) < 1e-9);
  assert.equal(last.y, 33);
  assert.equal(s.usedNow, 33);
});

test("only the part of a day that went over its budget is marked", () => {
  const s = run(reading(), "paceSeries(__m)");
  assert.equal(s.over.length, 1); // Wednesday spent 20 of a 14.3 budget; Thursday and today stayed inside
  const [a, b] = s.over[0];
  assert.ok(Math.abs(a.y - 14.3) < 1e-9, "starts where the budget ran out");
  assert.equal(b.y, 20);
  assert.equal(b.x, 1);
});

test("a pace that fits the week leads to the reset, with what is projected there", () => {
  const r = reading({ used: 30, days: { "2026-10-28": { spent: 10, budget: 14.3, endUsed: 10 }, "2026-10-29": { spent: 10, budget: 14.3, endUsed: 20 }, "2026-10-30": { spent: 10, budget: 14.3, endUsed: 30 } } });
  const out = run(r, "({ s: paceSeries(__m), projected: __m.lv.proj.projected })");
  assert.equal(out.s.end.kind, "reset");
  assert.ok(Math.abs(out.s.end.pct - out.projected) < 0.01, "the chart and the verdict agree on the projection");
  const tip = out.s.proj[out.s.proj.length - 1];
  assert.ok(Math.abs(tip.x - out.s.span) < 1e-9);
  assert.ok(Math.abs(tip.y - out.projected) < 0.01);
  assert.ok(out.s.proj[0].y === 30 && Math.abs(out.s.proj[0].x - out.s.nowX) < 1e-9);
});

test("a pace that leaves hours without Claude stops at 100% at T, and the lock runs on from T to the reset", () => {
  const r = reading({ used: 70, days: { "2026-10-28": { spent: 30, budget: 14.3, endUsed: 30 }, "2026-10-29": { spent: 20, budget: 14.3, endUsed: 50 }, "2026-10-30": { spent: 20, budget: 14.3, endUsed: 70 } } });
  const s = run(r, "paceSeries(__m)");
  const lv = run(r, "__m.lv");
  assert.equal(s.end.kind, "lock");
  assert.equal(s.end.ms, lv.lock.at, "the same T as the level");
  assert.ok(s.end.ms > at(2026, 10, 30, 20) && s.end.ms < RESET);
  const tip = s.proj[s.proj.length - 1];
  assert.equal(tip.y, 100);
  assert.ok(tip.x < s.span);
  assert.equal(s.lock.length, 2);
  assert.deepEqual(s.lock.map((p) => p.y), [100, 100]);
  assert.equal(s.lock[0].x, tip.x);
  assert.equal(s.lock[1].x, s.span);
});

test("a pace that never reaches 100% runs to the reset with no lock", () => {
  const s = run(reading({ used: 20 }), "paceSeries(__m)");
  assert.equal(s.end.kind, "reset");
  assert.equal(s.lock, null);
});

test("a week already at 100 has no projection", () => {
  const s = run(reading({ used: 100 }), "paceSeries(__m)");
  assert.equal(s.end.kind, "out");
  assert.equal(s.proj, null);
});

test("a day off that still had spend is rated, a day off with none stays off", () => {
  const off = [1, 1, 1, 0, 1, 1, 1]; // Wednesday, the first day of the plan, is Off
  const spentOnOff = run(reading({ settings: { weights: off }, days: {
    "2026-10-28": { spent: 5, budget: 0, endUsed: 5 },
    "2026-10-29": { spent: 8, budget: 14.3, endUsed: 13 },
    "2026-10-30": { spent: 5, budget: 14.3, endUsed: 33 },
  } }), "weekPlan(__m)");
  assert.equal(spentOnOff[0].name, "off");
  assert.equal(spentOnOff[0].kind, "past", "it had spend, so it is not shown as a day off");
  assert.equal(spentOnOff[0].level, 3, "any spend against a zero budget is Pause");

  const quiet = run(reading({ settings: { weights: off }, days: {
    "2026-10-28": { spent: 0, budget: 0, endUsed: 0 },
    "2026-10-29": { spent: 8, budget: 14.3, endUsed: 8 },
    "2026-10-30": { spent: 5, budget: 14.3, endUsed: 33 },
  } }), "weekPlan(__m)");
  assert.equal(quiet[0].kind, "off");
  assert.equal(quiet[0].level, null);
});

test("a past day with no record has no numbers and is not rated", () => {
  const plan = run(reading({ days: {
    "2026-10-29": { spent: 8, budget: 14.3, endUsed: 28 },
    "2026-10-30": { spent: 5, budget: 14.3, endUsed: 33 },
  } }), "weekPlan(__m)");
  assert.equal(plan[0].kind, "past");
  assert.equal(plan[0].spent, null);
  assert.equal(plan[0].ratio, null);
  assert.equal(plan[0].level, null);
});

test("today uses the live budget and spend", () => {
  const sb = run(reading(), "({ today: weekPlan(__m)[2], budget: __m.budget, spent: __m.spent })");
  assert.equal(sb.today.budget, sb.budget);
  assert.equal(sb.today.spent, sb.spent);
  assert.equal(sb.today.isToday, true);
});

test("when every day ahead is Off they get no budget, and nothing divides by zero", () => {
  const weights = [0, 0, 0, 1, 1, 1, 0]; // Sun Mon Tue off, Wed Thu Fri on, Sat off
  const plan = run(reading({ settings: { weights } }), "weekPlan(__m)");
  const ahead = plan.slice(3); // Sat, Sun, Mon, Tue
  assert.ok(ahead.every((d) => d.budget === 0 && d.kind === "off" && d.level === null), JSON.stringify(ahead));
  assert.ok(plan.every((d) => d.budget === null || Number.isFinite(d.budget)));
});

test("the room box runs from now to the reset, from what is used to the goal", () => {
  const s = run(reading(), "paceSeries(__m)");
  assert.ok(Math.abs(s.room.x0 - s.nowX) < 1e-9);
  assert.equal(s.room.x1, s.span);
  assert.equal(s.room.y0, 33);
  assert.equal(s.room.y1, 100);
  assert.equal(run(reading({ used: 100 }), "paceSeries(__m).room"), null, "nothing left: no box");
});

test("the room box stops at the plan's ceiling at the reset when the reserve is never released", () => {
  const settings = { reserve: 10, reserveRelease: 0 };
  assert.equal(run(reading({ settings }), "paceSeries(__m).room.y1"), 90);
  const released = { reserve: 10, reserveRelease: 48 };
  assert.equal(run(reading({ settings: released }), "paceSeries(__m).room.y1"), 100);
});

test("today's own share of the plan is the rise of the expected line over today", () => {
  const exp = (ms) => `expectedUsed(${RESET}, ${ms}, weights(), __m.g)`;
  const out = run(reading(), `({ share: __m.planToday, a: ${exp(at(2026, 10, 31))}, b: ${exp(at(2026, 10, 30))} })`);
  assert.ok(Math.abs(out.share - (out.a - out.b)) < 1e-9);
  assert.ok(Math.abs(out.share - 100 / 7) < 1e-9, "seven even days: a seventh of the week");
});

test("the week turns to the accent only on its last day, and only with room to spend", () => {
  // Tue 11-03 12:00, 20 h before the reset, at 40%: the pace ends far under the goal
  const days = { "2026-11-03": { spent: 5, budget: 14, endUsed: 40 } };
  const last = reading({ used: 40, days, now: at(2026, 11, 3, 12) });
  last.src.data.dayStart = { day: "2026-11-03", at: at(2026, 11, 3), used: 35 };
  assert.equal(run(last, "__m.head.room"), true);
  assert.equal(run(last, "__m.endRoom"), true);
  assert.equal(run(reading({ used: 10 }), "__m.endRoom"), false, "days before the reset: the level's color");
  const tight = reading({ used: 95, days, now: at(2026, 11, 3, 12) });
  tight.src.data.dayStart = { day: "2026-11-03", at: at(2026, 11, 3), used: 90 };
  assert.equal(run(tight, "__m.endRoom"), false, "no room: the level's color");
});

test("the strong part of the room box starts where the projection ends, and its number is the band's to spend", () => {
  const out = run(reading({ used: 20 }), "({ room: paceSeries(__m).room, proj: __m.lv.proj.projected, ceil: __m.ceiling })");
  assert.ok(Math.abs(out.room.mid - out.proj) < 1e-9);
  assert.equal(out.room.spend, Math.round(out.ceil) - Math.round(out.proj));
  // A pace that reaches the goal leaves nothing extra to spend: no strong part, no number
  const fast = run(reading({ used: 60 }), "paceSeries(__m).room");
  assert.equal(fast.mid, null);
  assert.equal(fast.spend, 0);
});
